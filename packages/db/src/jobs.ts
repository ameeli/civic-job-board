import {
  SOURCES,
  linkKeys,
  sameLevel,
  trigramSimilarity,
  type KnownJob,
  type NormalizedJob,
  type SourceResult,
} from "@civic-job-board/core";
import { and, arrayOverlaps, eq, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { resolveOrganization } from "./organizations";
import {
  aiQueue,
  jobSightings,
  jobTags,
  jobs,
  pageCopies,
  type JobSighting,
  type SightingData,
} from "./schema";
import type { Db } from "./source-runs";

/** Checks a full listing must miss a job on before its sighting counts as gone. */
export const MISSED_CHECKS_BEFORE_GONE = 3;
/** For feeds and newsletters, which only show recent jobs: days unseen before a sighting counts as gone. */
export const RECENT_FEED_GONE_DAYS = 30;
/** Page copies of jobs closed longer than this are deleted. */
export const PAGE_COPY_RETENTION_DAYS = 90;
/** Two titles at one employer this similar (trigram similarity) can be the same job. */
const SAME_TITLE_SIMILARITY = 0.7;
/** A shared posting link (not an ATS id) only merges jobs at one employer whose titles are at least this similar. */
const SHARED_LINK_TITLE_SIMILARITY = 0.4;

const DAY_MS = 86_400_000;
// A daily check may run more than once a day (chained runs, a duplicate
// delivery); a missing job is only counted once per this window.
const MISS_COUNT_WINDOW_MS = 12 * 3_600_000;

const SOURCE_ORDER = SOURCES.map((source) => source.id);

export interface IngestResult {
  /** Jobs the source lists right now (its full listing, or the jobs in its feed). */
  seen: number;
  /** Jobs this source had not listed before. */
  new: number;
}

/** The source's stored jobs, for adapters to skip work they have already done. */
export async function knownJobs(db: Db, source: string): Promise<Map<string, KnownJob>> {
  const rows = await db
    .select({ externalId: jobSightings.externalId, version: jobSightings.version })
    .from(jobSightings)
    .where(eq(jobSightings.source, source));
  return new Map(rows.map((row) => [row.externalId, { version: row.version }]));
}

/**
 * Stores one source's check: upserts a sighting per job, merges each new
 * sighting into the canonical job it duplicates (or creates one and queues
 * it for the AI step), and records which stored jobs the source no longer
 * lists. Safe to repeat: the same result stored twice changes nothing more.
 */
export async function ingestSourceResult(
  db: Db,
  input: { source: string; sharedSourceUrls?: boolean; result: SourceResult; now: Date },
): Promise<IngestResult> {
  const { source, result, now } = input;
  let created = 0;
  for (const job of result.jobs) {
    const isNew = await db.transaction((tx) =>
      ingestJob(tx, source, job, input.sharedSourceUrls ?? false, now),
    );
    if (isNew) {
      created++;
    }
  }

  const emitted = result.jobs.map((job) => job.externalId);
  if (result.listedIds && result.listedIds.length > 0) {
    await applyListing(db, source, [...new Set([...result.listedIds, ...emitted])], now);
  } else if (result.listedIds === null) {
    await expireStaleFeedSightings(db, source, now);
  }
  // An empty full listing means the source broke, not that every job closed; it is left alone.

  return { seen: result.seen ?? result.listedIds?.length ?? result.jobs.length, new: created };
}

async function ingestJob(
  tx: Db,
  source: string,
  job: NormalizedJob,
  sharedSourceUrls: boolean,
  now: Date,
): Promise<boolean> {
  const [existing] = await tx
    .select()
    .from(jobSightings)
    .where(and(eq(jobSightings.source, source), eq(jobSightings.externalId, job.externalId)));

  const data = existing ? mergeSightingData(existing.data, toSightingData(job)) : toSightingData(job);
  const keys = sightingKeys(data.applyUrl, sharedSourceUrls ? null : job.sourceUrl);
  const organizationId = (await resolveOrganization(tx, data)) ?? existing?.organizationId ?? null;

  let sightingId: number;
  let jobId: number;
  if (existing) {
    sightingId = existing.id;
    jobId = (await canMergeSighting(tx, existing.jobId, source, keys, existing.id))
      ? existing.jobId
      : (await findDuplicateJob(tx, { source, keys, organizationId, data, now })) ??
        (await createJob(tx, data, organizationId, now));
    await tx
      .update(jobSightings)
      .set({
        jobId,
        data,
        sourceUrl: job.sourceUrl,
        organizationId,
        linkKeys: keys,
        version: job.version ?? existing.version,
        via: job.via ?? existing.via,
        lastSeenAt: now,
        goneAt: null,
      })
      .where(eq(jobSightings.id, existing.id));
    if (jobId !== existing.jobId) {
      await tx.update(pageCopies).set({ jobId }).where(eq(pageCopies.sightingId, existing.id));
      await refreshJob(tx, existing.jobId, now, false);
    }
  } else {
    jobId =
      (await findDuplicateJob(tx, { source, keys, organizationId, data, now })) ??
      (await createJob(tx, data, organizationId, now));
    const [inserted] = await tx
      .insert(jobSightings)
      .values({
        jobId,
        source,
        externalId: job.externalId,
        sourceUrl: job.sourceUrl,
        organizationId,
        linkKeys: keys,
        data,
        version: job.version ?? null,
        via: job.via ?? null,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .returning({ id: jobSightings.id });
    sightingId = inserted!.id;
  }

  if (job.page) {
    await tx
      .insert(pageCopies)
      .values({ jobId, sightingId, url: job.page.url, html: job.page.html, fetchedAt: now })
      .onConflictDoUpdate({
        target: pageCopies.sightingId,
        set: { jobId, url: job.page.url, html: job.page.html, fetchedAt: now },
      });
  }
  await refreshJob(tx, jobId, now);
  return !existing;
}

async function createJob(
  tx: Db,
  data: SightingData,
  organizationId: number | null,
  now: Date,
): Promise<number> {
  const [row] = await tx
    .insert(jobs)
    .values({ title: data.title, organizationId, firstSeenAt: now, lastSeenAt: now })
    .returning({ id: jobs.id });
  await tx.insert(aiQueue).values({ jobId: row!.id, enqueuedAt: now, availableAt: now });
  return row!.id;
}

/**
 * Finds the canonical job a new sighting duplicates, in order of certainty:
 * 1. A shared ATS job id, or a shared posting link with a similar title at
 *    the same employer (when both employers are known).
 * 2. The same employer, a very similar title, and compatible pay and
 *    location, among its open or recently closed jobs.
 * Titles at different levels ("Engineer" and "Engineer II") never match.
 * A job never absorbs a second sighting from the same source: one source
 * does not list one job twice.
 */
async function findDuplicateJob(
  tx: Db,
  input: { source: string; keys: string[]; organizationId: number | null; data: SightingData; now: Date },
): Promise<number | null> {
  const { source, keys, organizationId, data, now } = input;
  if (keys.length > 0) {
    const matches = await tx
      .select({
        jobId: jobSightings.jobId,
        linkKeys: jobSightings.linkKeys,
        title: jobs.title,
        organizationId: jobs.organizationId,
      })
      .from(jobSightings)
      .innerJoin(jobs, eq(jobs.id, jobSightings.jobId))
      .where(arrayOverlaps(jobSightings.linkKeys, keys));
    for (const match of matches) {
      const shared = match.linkKeys.filter((key) => keys.includes(key));
      const byAtsId = shared.some((key) => key.startsWith("ats:"));
      const byLink =
        (organizationId === null || match.organizationId === null || match.organizationId === organizationId) &&
        sameLevel(match.title, data.title) &&
        trigramSimilarity(match.title, data.title) >= SHARED_LINK_TITLE_SIMILARITY;
      if (
        (byAtsId || byLink) &&
        (await canMergeSighting(tx, match.jobId, source, keys))
      ) {
        return match.jobId;
      }
    }
  }

  if (organizationId === null) {
    return null;
  }
  const candidates = await tx
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.organizationId, organizationId),
        or(eq(jobs.status, "open"), sql`${jobs.closedAt} > ${new Date(now.getTime() - 30 * DAY_MS)}`),
      ),
    );
  let best: { id: number; similarity: number } | null = null;
  for (const candidate of candidates) {
    const similarity = trigramSimilarity(candidate.title, data.title);
    if (
      similarity >= SAME_TITLE_SIMILARITY &&
      sameLevel(candidate.title, data.title) &&
      (!best || similarity > best.similarity) &&
      compatiblePay(candidate, data) &&
      compatibleLocation(candidate, data) &&
      (await canMergeSighting(tx, candidate.id, source, keys))
    ) {
      best = { id: candidate.id, similarity };
    }
  }
  return best?.id ?? null;
}

async function canMergeSighting(
  tx: Db,
  jobId: number,
  source: string,
  keys: string[],
  sightingId?: number,
): Promise<boolean> {
  const sightings = await tx
    .select({ id: jobSightings.id, source: jobSightings.source, linkKeys: jobSightings.linkKeys })
    .from(jobSightings)
    .where(eq(jobSightings.jobId, jobId));
  const atsKeys = keys.filter((key) => key.startsWith("ats:"));
  return sightings.filter((sighting) => sighting.id !== sightingId).every((sighting) =>
    sighting.source !== source &&
    !sighting.linkKeys.some((known) =>
      known.startsWith("ats:") && atsKeys.some((incoming) =>
        known.split(":")[1] === incoming.split(":")[1] && known !== incoming,
      ),
    ),
  );
}

function compatiblePay(
  job: { salaryMin: number | null; salaryMax: number | null; salaryPeriod: string | null; salaryCurrency: string | null },
  data: SightingData,
): boolean {
  if (job.salaryCurrency && data.salary?.currency && job.salaryCurrency !== data.salary.currency) {
    return false;
  }
  if (!data.salary || job.salaryMin === null || job.salaryPeriod === null) {
    return true;
  }
  if (job.salaryPeriod !== data.salary.period) {
    return false;
  }
  // Ranges overlap, allowing 10% for rounding ("$121K" against "$121,000-$175,000").
  const low = (data.salary.min ?? data.salary.max!) * 0.9;
  const high = (data.salary.max ?? data.salary.min!) * 1.1;
  return job.salaryMin <= high && (job.salaryMax ?? job.salaryMin) >= low;
}

function compatibleLocation(job: { remoteType: string | null }, data: SightingData): boolean {
  return !job.remoteType || !data.remoteType || job.remoteType === data.remoteType || [job.remoteType, data.remoteType].includes("hybrid");
}

/**
 * Re-derives a canonical job from all its sightings: for each field, the
 * first source in `SOURCES` order that has a value wins; the earliest posted
 * date and the full set of board tags are kept.
 */
export async function refreshJob(
  tx: Db,
  jobId: number,
  now: Date,
  preserveInferredEmployer = true,
): Promise<void> {
  const [previous] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
  const previousTags = await tx.select({ tag: jobTags.tag }).from(jobTags)
    .where(and(eq(jobTags.jobId, jobId), eq(jobTags.origin, "board")));
  const sightings = await tx.select().from(jobSightings).where(eq(jobSightings.jobId, jobId));
  if (sightings.length === 0) {
    return;
  }
  sightings.sort(bySourceOrder);
  const first = <T>(pick: (s: JobSighting) => T | null | undefined): T | null => {
    for (const sighting of sightings) {
      const value = pick(sighting);
      if (value !== null && value !== undefined) {
        return value;
      }
    }
    return null;
  };
  const salary = first((s) => s.data.salary);
  const postedDates = sightings
    .map((s) => s.data.postedAt)
    .filter((d): d is string => d !== null)
    .map((d) => new Date(d).getTime());
  const expiresAt = sightings.find((s) => s.data.expiresAt !== undefined)?.data.expiresAt;
  const organizationId = first((s) => s.organizationId);

  const [updated] = await tx
    .update(jobs)
    .set({
      title: first((s) => s.data.title) ?? sightings[0]!.data.title,
      organizationId: organizationId ?? (preserveInferredEmployer ? previous?.organizationId ?? null : null),
      location: first((s) => s.data.location),
      remoteType: first((s) => s.data.remoteType),
      salaryMin: salary?.min ?? null,
      salaryMax: salary?.max ?? null,
      salaryCurrency: salary?.currency ?? null,
      salaryPeriod: salary?.period ?? null,
      description: first((s) => s.data.description),
      applyUrl: first((s) => s.data.applyUrl),
      postedAt: postedDates.length > 0 ? new Date(Math.min(...postedDates)) : null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      firstSeenAt: new Date(Math.min(...sightings.map((s) => s.firstSeenAt.getTime()))),
      lastSeenAt: new Date(Math.max(...sightings.map((s) => s.lastSeenAt.getTime()))),
    })
    .where(eq(jobs.id, jobId))
    .returning();

  await tx.delete(jobTags).where(and(eq(jobTags.jobId, jobId), eq(jobTags.origin, "board")));
  const boardTags = new Map<string, { axis: string; tag: string }>();
  for (const sighting of sightings) {
    for (const tag of sighting.data.boardTags) {
      boardTags.set(`${tag.axis}\u0000${tag.tag}`, tag);
    }
  }
  if (boardTags.size > 0) {
    await tx
      .insert(jobTags)
      .values([...boardTags.values()].map((tag) => ({ jobId, origin: "board" as const, ...tag })))
      .onConflictDoNothing();
  }
  if (previous && updated && (
    previous.title !== updated.title || previous.organizationId !== updated.organizationId ||
    previous.location !== updated.location || previous.description !== updated.description ||
    JSON.stringify(previousTags.map(({ tag }) => tag).sort()) !==
      JSON.stringify([...boardTags.values()].map(({ tag }) => tag).sort())
  )) {
    await tx.update(jobs).set({ summary: null, aiTaggedAt: null }).where(eq(jobs.id, jobId));
    await tx.delete(jobTags).where(and(eq(jobTags.jobId, jobId), eq(jobTags.origin, "ai")));
    await tx.insert(aiQueue).values({ jobId, enqueuedAt: now, availableAt: now })
      .onConflictDoUpdate({
        target: aiQueue.jobId,
        set: { enqueuedAt: now, availableAt: now, attempts: 0, lastError: null },
      });
  }
}

function bySourceOrder(a: JobSighting, b: JobSighting): number {
  const rank = (s: JobSighting) => {
    const index = SOURCE_ORDER.indexOf(s.source);
    return index === -1 ? SOURCE_ORDER.length : index;
  };
  return rank(a) - rank(b) || a.firstSeenAt.getTime() - b.firstSeenAt.getTime() || a.id - b.id;
}

/** Full listings: present sightings are reset; absent ones count a miss and are gone after several. */
async function applyListing(db: Db, source: string, listedIds: string[], now: Date): Promise<void> {
  await db
    .update(jobSightings)
    .set({ lastSeenAt: now, missedChecks: 0, checkedAt: now, goneAt: null })
    .where(and(eq(jobSightings.source, source), inArray(jobSightings.externalId, listedIds)));
  await db
    .update(jobs)
    .set({
      lastSeenAt: sql`(select max(${jobSightings.lastSeenAt}) from ${jobSightings} where ${jobSightings.jobId} = ${jobs.id})`,
    })
    .where(inArray(jobs.id, db.select({ jobId: jobSightings.jobId }).from(jobSightings)
      .where(and(eq(jobSightings.source, source), inArray(jobSightings.externalId, listedIds)))));
  await db
    .update(jobSightings)
    .set({
      missedChecks: sql`${jobSightings.missedChecks} + 1`,
      checkedAt: now,
      goneAt: sql`case when ${jobSightings.missedChecks} + 1 >= ${MISSED_CHECKS_BEFORE_GONE} then coalesce(${jobSightings.goneAt}, ${now}) else ${jobSightings.goneAt} end`,
    })
    .where(
      and(
        eq(jobSightings.source, source),
        notInArray(jobSightings.externalId, listedIds),
        or(
          isNull(jobSightings.checkedAt),
          lt(jobSightings.checkedAt, new Date(now.getTime() - MISS_COUNT_WINDOW_MS)),
        ),
      ),
    );
}

/** Feeds and newsletters: a sighting not seen for a long time is gone. */
async function expireStaleFeedSightings(db: Db, source: string, now: Date): Promise<void> {
  await db
    .update(jobSightings)
    .set({ goneAt: now })
    .where(
      and(
        eq(jobSightings.source, source),
        isNull(jobSightings.goneAt),
        lt(jobSightings.lastSeenAt, new Date(now.getTime() - RECENT_FEED_GONE_DAYS * DAY_MS)),
      ),
    );
}

/**
 * Closes open jobs whose application deadline day has passed or whose every
 * sighting is gone, and reopens closed jobs a source lists again with no
 * passed deadline. Returns how many jobs changed each way.
 */
export async function updateJobStatuses(db: Db, now: Date): Promise<{ closed: number; reopened: number }> {
  const liveSighting = sql`exists (select 1 from ${jobSightings} where ${jobSightings.jobId} = ${jobs.id} and ${jobSightings.goneAt} is null)`;
  // A deadline is usually a date, open through that whole day wherever the employer is.
  const deadlinePassed = sql`${jobs.expiresAt} + interval '1 day' <= ${now}`;
  const expired = await db
    .update(jobs)
    .set({ status: "closed", closedAt: now, closedReason: "expired" })
    .where(and(eq(jobs.status, "open"), deadlinePassed))
    .returning({ id: jobs.id });
  const gone = await db
    .update(jobs)
    .set({ status: "closed", closedAt: now, closedReason: "gone" })
    .where(and(eq(jobs.status, "open"), sql`not ${liveSighting}`))
    .returning({ id: jobs.id });
  const reopened = await db
    .update(jobs)
    .set({ status: "open", closedAt: null, closedReason: null })
    .where(
      and(
        eq(jobs.status, "closed"),
        or(isNull(jobs.expiresAt), sql`not ${deadlinePassed}`),
        liveSighting,
      ),
    )
    .returning({ id: jobs.id });
  return { closed: expired.length + gone.length, reopened: reopened.length };
}

/** Deletes page copies of jobs closed more than 90 days ago. The jobs themselves are kept. */
export async function trimPageCopies(db: Db, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - PAGE_COPY_RETENTION_DAYS * DAY_MS);
  const deleted = await db
    .delete(pageCopies)
    .where(
      inArray(
        pageCopies.jobId,
        db
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.status, "closed"), lt(jobs.closedAt, cutoff))),
      ),
    )
    .returning({ id: pageCopies.id });
  return deleted.length;
}

export function toSightingData(job: NormalizedJob): SightingData {
  return {
    title: job.title,
    orgName: job.orgName,
    orgWebsite: job.orgWebsite,
    location: job.location,
    remoteType: job.remoteType,
    salary: job.salary,
    description: job.description,
    applyUrl: job.applyUrl,
    postedAt: job.postedAt?.toISOString() ?? null,
    ...(job.expiresAt !== undefined ? { expiresAt: job.expiresAt?.toISOString() ?? null } : {}),
    boardTags: job.boardTags,
  };
}

/**
 * A later check of the same job: its values win, but it does not erase what
 * an earlier check found and this one skipped (for example a description
 * read once from the job's page). An explicit null deadline clears the old
 * deadline; an omitted deadline preserves it. The first posted date is kept.
 */
export function mergeSightingData(previous: SightingData, next: SightingData): SightingData {
  const merged = { ...previous };
  for (const key of Object.keys(next) as (keyof SightingData)[]) {
    const value = next[key];
    if (value !== undefined && (value !== null || key === "expiresAt") && !(Array.isArray(value) && value.length === 0)) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  merged.postedAt = previous.postedAt ?? next.postedAt;
  return merged;
}

function sightingKeys(applyUrl: string | null, sourceUrl: string | null): string[] {
  return [...new Set([...linkKeys(applyUrl), ...linkKeys(sourceUrl)])];
}
