import {
  GeminiError,
  SOURCES,
  SOURCE_HOST_DELAYS,
  createGeminiTagger,
  createHttpClient,
  type FetchLike,
  type SourceAdapter,
} from "@civic-job-board/core";
import {
  acquireLease,
  countReadyAiJobs,
  ingestSourceResult,
  knownJobs,
  nextAiBatch,
  recordAiFailure,
  recordSourceRun,
  releaseLease,
  saveAiTagging,
  sourcesCheckedSince,
  trimPageCopies,
  updateJobStatuses,
  type Db,
} from "@civic-job-board/db";

/** A source that finished a check this recently is not checked again (the cron runs daily). */
const RECHECK_AFTER_MS = 20 * 3_600_000;
/** Time kept back from source checks for storing results, closing jobs, and the AI step. */
const SOURCES_RESERVE_MS = 45_000;
/** A Gemini request is only started with at least this much time left. */
const AI_REQUEST_RESERVE_MS = 35_000;
/** Jobs per Gemini request. Small batches keep each request quick and cheap. */
const AI_BATCH_SIZE = 5;
/**
 * Gemini requests per minute. Google shows each project's free-tier limits
 * in AI Studio rather than in its docs; set GEMINI_REQUESTS_PER_MINUTE to
 * fit the project's limits (see README.md's AI tags section).
 */
export const DEFAULT_AI_REQUESTS_PER_MINUTE = 10;
const LEASE_NAME = "daily-check";

export interface DailyCheckOptions {
  db: Db;
  fetch: FetchLike;
  /** Stop starting new work after this time. */
  deadline: Date;
  /** Without a key the AI step is skipped and its jobs wait in the queue. */
  geminiApiKey?: string;
  geminiModel?: string;
  aiRequestsPerMinute?: number;
  /** Check every source even if it was checked in the last 20 hours. */
  force?: boolean;
  sources?: readonly SourceAdapter[];
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface SourceCheck {
  source: string;
  ok: boolean;
  seen: number;
  new: number;
  partial: boolean;
  error?: string;
}

export interface DailyCheckSummary {
  /** `busy`: another run of the daily check holds the lease, so this one did nothing. */
  status: "done" | "busy";
  sources: SourceCheck[];
  closed: number;
  reopened: number;
  trimmedPageCopies: number;
  ai: { tagged: number; failed: number; stopped: "no-key" | "rate-limited" | "error" | null };
  /** True when time ran out with work left; the caller should start another run. */
  moreWork: boolean;
}

/**
 * The daily check: polls every source that is due, records one
 * `source_runs` row per source, closes and reopens jobs, trims old page
 * copies, then tags queued jobs with Gemini, pacing requests under the free
 * tier's per-minute limit.
 *
 * Safe to run twice or after missed days: a lease keeps two runs from
 * overlapping, sources already checked in the last 20 hours are skipped, and
 * storing a check is idempotent. When `deadline` arrives first, the summary
 * says `moreWork` and the next run continues.
 */
export async function runDailyCheck(options: DailyCheckOptions): Promise<DailyCheckSummary> {
  const {
    db,
    deadline,
    sources = SOURCES,
    now = () => new Date(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;
  const summary: DailyCheckSummary = {
    status: "done",
    sources: [],
    closed: 0,
    reopened: 0,
    trimmedPageCopies: 0,
    ai: { tagged: 0, failed: 0, stopped: null },
    moreWork: false,
  };

  const holder = crypto.randomUUID();
  const leaseUntil = new Date(deadline.getTime() + 60_000);
  if (!(await acquireLease(db, { name: LEASE_NAME, holder, expiresAt: leaseUntil, now: now() }))) {
    return { ...summary, status: "busy" };
  }
  try {
    const http = createHttpClient({ fetch: options.fetch, hostDelayMs: SOURCE_HOST_DELAYS });
    const checked = options.force
      ? new Set<string>()
      : await sourcesCheckedSince(db, new Date(now().getTime() - RECHECK_AFTER_MS));
    const sourcesDeadline = new Date(deadline.getTime() - SOURCES_RESERVE_MS);

    for (const source of sources) {
      if (checked.has(source.id)) {
        continue;
      }
      if (now() >= sourcesDeadline) {
        summary.moreWork = true;
        break;
      }
      const check = await checkSource(db, source, http, sourcesDeadline, now);
      summary.sources.push(check);
      summary.moreWork ||= check.partial;
    }

    const statuses = await updateJobStatuses(db, now());
    summary.closed = statuses.closed;
    summary.reopened = statuses.reopened;
    summary.trimmedPageCopies = await trimPageCopies(db, now());

    const ai = await drainAiQueue(options, deadline, now, sleep);
    summary.ai = ai.result;
    summary.moreWork ||= ai.moreWork;
  } finally {
    await releaseLease(db, { name: LEASE_NAME, holder });
  }
  return summary;
}

async function checkSource(
  db: Db,
  source: SourceAdapter,
  http: ReturnType<typeof createHttpClient>,
  deadline: Date,
  now: () => Date,
): Promise<SourceCheck> {
  const startedAt = now();
  try {
    const result = await source.fetchJobs({
      http,
      now: startedAt,
      known: await knownJobs(db, source.id),
      deadline,
    });
    const stored = await ingestSourceResult(db, {
      source: source.id,
      sharedSourceUrls: source.sharedSourceUrls,
      result,
      now: startedAt,
    });
    await recordSourceRun(db, {
      source: source.id,
      startedAt,
      finishedAt: now(),
      ok: true,
      seen: stored.seen,
      new: stored.new,
      partial: result.partial,
    });
    return { source: source.id, ok: true, ...stored, partial: result.partial };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordSourceRun(db, {
      source: source.id,
      startedAt,
      finishedAt: now(),
      ok: false,
      error: message.slice(0, 1_000),
    });
    return { source: source.id, ok: false, seen: 0, new: 0, partial: false, error: message };
  }
}

async function drainAiQueue(
  options: DailyCheckOptions,
  deadline: Date,
  now: () => Date,
  sleep: (ms: number) => Promise<void>,
): Promise<{ result: DailyCheckSummary["ai"]; moreWork: boolean }> {
  const { db } = options;
  const result: DailyCheckSummary["ai"] = { tagged: 0, failed: 0, stopped: null };
  if (!options.geminiApiKey) {
    return { result: { ...result, stopped: "no-key" }, moreWork: false };
  }
  const tagger = createGeminiTagger({
    apiKey: options.geminiApiKey,
    fetch: options.fetch,
    model: options.geminiModel,
    timeoutMs: AI_REQUEST_RESERVE_MS - 5_000,
  });
  const gapMs = 60_000 / (options.aiRequestsPerMinute ?? DEFAULT_AI_REQUESTS_PER_MINUTE);
  let lastRequestAt: number | null = null;

  while (true) {
    const waitMs = lastRequestAt === null ? 0 : Math.max(0, lastRequestAt + gapMs - now().getTime());
    if (now().getTime() + waitMs > deadline.getTime() - AI_REQUEST_RESERVE_MS) {
      return { result, moreWork: (await countReadyAiJobs(db, now())) > 0 };
    }
    const batch = await nextAiBatch(db, { limit: AI_BATCH_SIZE, now: now() });
    if (batch.length === 0) {
      return { result, moreWork: false };
    }
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    lastRequestAt = now().getTime();
    try {
      const taggings = await tagger.tagJobs(batch);
      for (const tagging of taggings) {
        await saveAiTagging(db, tagging, now());
      }
      const tagged = new Set(taggings.map((tagging) => tagging.id));
      const missed = batch.filter((job) => !tagged.has(job.id)).map((job) => Number(job.id));
      await recordAiFailure(db, { jobIds: missed, error: "Missing or invalid in the model's answer", now: now() });
      result.tagged += taggings.length;
      result.failed += missed.length;
    } catch (error) {
      if (error instanceof GeminiError && error.rateLimited) {
        // The free tier's limit is reached; the queue waits for the next run.
        return { result: { ...result, stopped: "rate-limited" }, moreWork: false };
      }
      const message = error instanceof Error ? error.message : String(error);
      await recordAiFailure(db, { jobIds: batch.map((job) => Number(job.id)), error: message, now: now() });
      result.failed += batch.length;
      // Gemini itself is failing; retrying now would only fail again.
      return { result: { ...result, stopped: "error" }, moreWork: false };
    }
  }
}
