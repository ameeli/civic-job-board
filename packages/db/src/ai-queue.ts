import type { JobForTagging, JobTagging } from "@civic-job-board/core";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { resolveOrganization } from "./organizations";
import { aiQueue, jobTags, jobs, organizations } from "./schema";
import type { Db } from "./source-runs";

/** The oldest jobs waiting for the AI step, with only their public posting fields. */
export async function nextAiBatch(db: Db, input: { limit: number; now: Date }): Promise<JobForTagging[]> {
  const rows = await db
    .select({
      jobId: aiQueue.jobId,
      title: jobs.title,
      orgName: organizations.name,
      location: jobs.location,
      description: jobs.description,
    })
    .from(aiQueue)
    .innerJoin(jobs, eq(jobs.id, aiQueue.jobId))
    .leftJoin(organizations, eq(organizations.id, jobs.organizationId))
    .where(lte(aiQueue.availableAt, input.now))
    .orderBy(asc(aiQueue.enqueuedAt), asc(aiQueue.jobId))
    .limit(input.limit);
  if (rows.length === 0) {
    return [];
  }
  const tags = await db
    .select({ jobId: jobTags.jobId, tag: jobTags.tag })
    .from(jobTags)
    .where(and(inArray(jobTags.jobId, rows.map((row) => row.jobId)), eq(jobTags.origin, "board")));
  return rows.map((row) => ({
    id: String(row.jobId),
    title: row.title,
    orgName: row.orgName,
    location: row.location,
    description: row.description,
    boardTags: tags.filter((tag) => tag.jobId === row.jobId).map((tag) => tag.tag),
  }));
}

/** How many queued jobs are ready for the AI step now. */
export async function countReadyAiJobs(db: Db, now: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiQueue)
    .where(lte(aiQueue.availableAt, now));
  return row?.count ?? 0;
}

/**
 * Stores the AI step's tags and summary for one job and takes it off the
 * queue. Replaces earlier AI tags; board tags are untouched. When the job
 * had no employer, the one the model read from the posting is linked.
 */
export async function saveAiTagging(db: Db, tagging: JobTagging, now: Date): Promise<void> {
  const jobId = Number(tagging.id);
  await db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
    if (!job) {
      return;
    }
    await tx.delete(jobTags).where(and(eq(jobTags.jobId, jobId), eq(jobTags.origin, "ai")));
    await tx.insert(jobTags).values([
      { jobId, origin: "ai", axis: "function", tag: tagging.jobFunction.tag, confidence: tagging.jobFunction.confidence },
      ...tagging.sectors.map((sector) => ({
        jobId,
        origin: "ai" as const,
        axis: "sector",
        tag: sector.tag,
        confidence: sector.confidence,
      })),
      { jobId, origin: "ai", axis: "seniority", tag: tagging.seniority, confidence: null },
    ]);
    const organizationId =
      job.organizationId ??
      (tagging.organization
        ? await resolveOrganization(tx, { orgName: tagging.organization, applyUrl: job.applyUrl })
        : null);
    await tx
      .update(jobs)
      .set({ summary: tagging.summary, aiTaggedAt: now, organizationId })
      .where(eq(jobs.id, jobId));
    await tx.delete(aiQueue).where(eq(aiQueue.jobId, jobId));
  });
}

/** Backs off a job the AI step could not tag: 1, 2, 4, ... hours, at most a day. */
export async function recordAiFailure(
  db: Db,
  input: { jobIds: number[]; error: string; now: Date },
): Promise<void> {
  if (input.jobIds.length === 0) {
    return;
  }
  await db
    .update(aiQueue)
    .set({
      attempts: sql`${aiQueue.attempts} + 1`,
      lastError: input.error.slice(0, 500),
      availableAt: sql`${input.now}::timestamptz + least(power(2, ${aiQueue.attempts}), 24) * interval '1 hour'`,
    })
    .where(inArray(aiQueue.jobId, input.jobIds));
}
