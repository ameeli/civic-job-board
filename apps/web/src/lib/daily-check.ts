import { fetchGovRecords, GOV_SOURCE, mapGovJob } from "@civic-job-board/core/tech-jobs-for-gov";
import {
  buildTaggingRequest, MAX_JOBS_TAGGED_PER_RUN, PAUSE_BETWEEN_TAGGING_REQUESTS_MS, readTaggingAnswer,
  TAGGING_MODEL, TAGGING_RETRY_WAITS_S, TAGGING_RUN_SOURCE,
} from "@civic-job-board/core/job-tags";
import { readJobsToTag, recordSourceRun, saveJob, saveJobTags, type Db } from "@civic-job-board/db";

const GEMINI_API = `https://generativelanguage.googleapis.com/v1beta/models/${TAGGING_MODEL}:generateContent`;
const GEMINI_TIMEOUT_MS = 20_000;
/** No tagging request starts later than this after the run began, so it ends inside the 300 s limit. */
const LAST_TAGGING_REQUEST_AFTER_MS = 260_000;
/** Rate limited (429) or overloaded (503): retried after a wait, then tagging stops for the run. */
const RETRY_THEN_STOP_STATUSES = new Set([429, 503]);

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** One progress line, `[daily-check] <event> key=value ...`; never pass secrets or job text. */
function log(event: string, fields: Record<string, string | number | boolean | null> = {}) {
  const pairs = Object.entries(fields).map(([key, value]) =>
    `${key}=${typeof value === "string" && /[\s"=]/.test(value) ? JSON.stringify(value) : value}`);
  console.log(["[daily-check]", event, ...pairs].join(" "));
}

const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

/**
 * The source check, then Gemini tagging of untagged jobs. Each records its own
 * source_runs row; both rows are returned with the run's transient tagging failures.
 */
export async function dailyCheck(db: Db, { sleep = pause } = {}) {
  const startedAt = new Date();
  log("run-start");
  const sourceRun = await checkTechJobsForGov(db);
  const { taggingRun, transientFailures } = await tagUntaggedJobs(db, startedAt, sleep);
  log("run-done", {
    fetched: sourceRun.seen, new: sourceRun.new, tagged: taggingRun.new,
    defaulted_to_unknown: taggingRun.defaultedToUnknown, transient_failures: transientFailures,
    duration_ms: Date.now() - startedAt.getTime(),
  });
  return { sourceRun, taggingRun, transientFailures };
}

/** One source check; successful saves remain available if a later listing fails. */
async function checkTechJobsForGov(db: Db) {
  const startedAt = new Date();
  log("source-start", { source: GOV_SOURCE });
  let seen = 0;
  let saved = 0;
  let newJobs = 0;
  let error: string | null = null;
  try {
    const records = await fetchGovRecords();
    seen = records.length;
    for (const record of records) {
      const job = mapGovJob(record);
      if (await saveJob(db, job)) newJobs++;
      saved++;
    }
  } catch (cause) {
    error = errorMessage(cause);
  }
  log("source-done", {
    source: GOV_SOURCE, ok: error === null, fetched: seen, saved, new: newJobs,
    ...(error === null ? {} : { error }), duration_ms: Date.now() - startedAt.getTime(),
  });
  return recordSourceRun(db, {
    source: GOV_SOURCE, startedAt, finishedAt: new Date(),
    ok: error === null, seen, new: newJobs, error,
  });
}

type JobToTag = Awaited<ReturnType<typeof readJobsToTag>>[number];
type TaggingResult =
  | { outcome: "tagged" | "defaulted-to-unknown" | "already-tagged" }
  | { outcome: "transient-error"; error: string; status: number | null };

/** One Gemini request for one job, saved only if the job is still untagged. */
async function tagJob(db: Db, apiKey: string, job: JobToTag): Promise<TaggingResult> {
  try {
    const response = await fetch(GEMINI_API, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(buildTaggingRequest(job)),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        outcome: "transient-error", error: `Gemini: HTTP ${response.status}`,
        status: response.status,
      };
    }
    // Keep body-read failures outside the parse catch so interrupted responses remain retryable.
    const body = await response.text();
    let answer: unknown;
    try {
      answer = JSON.parse(body);
    } catch {
      answer = null;
    }
    const { tags, defaultedToUnknown } = readTaggingAnswer(answer);
    if (!await saveJobTags(db, job.id, tags)) return { outcome: "already-tagged" };
    return { outcome: defaultedToUnknown ? "defaulted-to-unknown" : "tagged" };
  } catch (cause) {
    return { outcome: "transient-error", error: errorMessage(cause), status: null };
  }
}

/** Tags the backlog; run counts and retry behavior are documented in README.md#job-tags. */
async function tagUntaggedJobs(db: Db, checkStartedAt: Date, sleep: (ms: number) => Promise<unknown>) {
  const startedAt = new Date();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    log("tagging-skipped", { reason: "missing-api-key" });
    const taggingRun = await recordSourceRun(db, {
      source: TAGGING_RUN_SOURCE, startedAt, finishedAt: new Date(), ok: false,
      error: "GEMINI_API_KEY is not set; tagging skipped",
    });
    return { taggingRun, transientFailures: 0 };
  }
  const elapsedMs = () => Date.now() - checkStartedAt.getTime();
  const selected = await readJobsToTag(db, MAX_JOBS_TAGGED_PER_RUN);
  log("tagging-start", { selected: selected.length, cap: MAX_JOBS_TAGGED_PER_RUN });
  let attempted = 0;
  let tagged = 0;
  let defaultedToUnknown = 0;
  let transientFailures = 0;
  let error: string | null = null;
  for (const [index, job] of selected.entries()) {
    if (index > 0) await sleep(PAUSE_BETWEEN_TAGGING_REQUESTS_MS);
    if (elapsedMs() > LAST_TAGGING_REQUEST_AFTER_MS) {
      log("tagging-stopped", { reason: "time-budget", untagged: selected.length - index });
      break;
    }
    attempted++;
    const jobStartedAt = Date.now();
    let result = await tagJob(db, apiKey, job);
    let attempt = 1;
    const recoveryStatus = result.outcome === "transient-error" && result.status !== null
      && RETRY_THEN_STOP_STATUSES.has(result.status) ? result.status : null;
    while (result.outcome === "transient-error" && result.status !== null && RETRY_THEN_STOP_STATUSES.has(result.status)) {
      if (attempt > TAGGING_RETRY_WAITS_S.length) {
        break;
      }
      const waitS = TAGGING_RETRY_WAITS_S[attempt - 1]!;
      if (elapsedMs() + waitS * 1000 > LAST_TAGGING_REQUEST_AFTER_MS) {
        log("tagging-retry-skipped", { job_id: job.id, status: result.status, wait_s: waitS, reason: "time-budget" });
        break;
      }
      attempt++;
      log("tagging-retry", { job_id: job.id, attempt, status: result.status, wait_s: waitS });
      await sleep(waitS * 1000);
      result = await tagJob(db, apiKey, job);
    }
    log("tagging-job", {
      n: `${index + 1}/${selected.length}`, job_id: job.id, outcome: result.outcome,
      ...(result.outcome === "transient-error"
        ? { ...(result.status === null ? {} : { status: result.status }), error: result.error } : {}),
      attempts: attempt, duration_ms: Date.now() - jobStartedAt,
    });
    if (result.outcome === "tagged" || result.outcome === "defaulted-to-unknown") tagged++;
    if (result.outcome === "defaulted-to-unknown") defaultedToUnknown++;
    if (result.outcome !== "transient-error") continue;
    transientFailures++;
    error ??= result.error;
    if (recoveryStatus !== null) {
      // The jobs not sent stay untagged and count as transient failures too.
      const notSent = selected.length - index - 1;
      attempted += notSent;
      transientFailures += notSent;
      log("tagging-stopped", {
        reason: recoveryStatus === 429 ? "rate-limited" : "overloaded", status: recoveryStatus, untagged: notSent,
      });
      break;
    }
  }
  const taggingRun = await recordSourceRun(db, {
    source: TAGGING_RUN_SOURCE, startedAt, finishedAt: new Date(),
    ok: error === null, seen: attempted, new: tagged, defaultedToUnknown, error,
  });
  return { taggingRun, transientFailures };
}
