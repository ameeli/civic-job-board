import { CTFG_SOURCE, fetchCtfgFeedItems, mapCtfgJob } from "@civic-job-board/core/civic-tech-field-guide";
import { fetchGovRecords, GOV_SOURCE, mapGovJob } from "@civic-job-board/core/tech-jobs-for-gov";
import {
  MAX_JOBS_TAGGED_PER_RUN, PAUSE_BETWEEN_TAGGING_REQUESTS_MS, TAGGING_RETRY_WAITS_S, TAGGING_RUN_SOURCE,
} from "@civic-job-board/core/job-tags";
import { readJobsToTag, recordSourceRun, saveJobTags, type Db } from "@civic-job-board/db";
import { logDailyCheck as log } from "./daily-check-log";
import { errorMessage } from "./error-message";
import { requestGeminiJobTags } from "./gemini-job-tags";
import { saveSourceJobs } from "./save-source-jobs";

/** No tagging request starts later than this after tagging began, so it ends inside the 300 s limit. */
const LAST_TAGGING_REQUEST_AFTER_MS = 260_000;
/** Rate limited (429) or overloaded (503): failed recovery stops tagging for the run. */
const RETRY_THEN_STOP_STATUSES = new Set([429, 503]);

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Checks every job source in turn and returns their source_runs rows. Each
 * source records its own run; fetch, mapping, and job-save failures are isolated
 * by saveSourceJobs. Failure to record a run stops the remaining checks.
 */
export async function fetchAndSaveJobs(db: Db) {
  return [
    await saveSourceJobs(db, GOV_SOURCE, fetchGovRecords, mapGovJob),
    await saveSourceJobs(db, CTFG_SOURCE, fetchCtfgFeedItems, mapCtfgJob),
  ];
}

type JobToTag = Awaited<ReturnType<typeof readJobsToTag>>[number];
type TaggingResult =
  | { outcome: "tagged" | "defaulted-to-unknown" | "already-tagged" }
  | { outcome: "transient-error"; error: string; status: number | null };

/** One Gemini request for one job, saved only if the job is still untagged. */
async function tagJob(db: Db, apiKey: string, job: JobToTag): Promise<TaggingResult> {
  const result = await requestGeminiJobTags(apiKey, job);
  if (result.outcome === "transient-error") return result;
  try {
    const { tags, defaultedToUnknown } = result.answer;
    if (!await saveJobTags(db, job.id, tags)) return { outcome: "already-tagged" };
    return { outcome: defaultedToUnknown ? "defaulted-to-unknown" : "tagged" };
  } catch (cause) {
    return { outcome: "transient-error", error: errorMessage(cause), status: null };
  }
}

/**
 * Sends untagged jobs to Gemini, then records the run's source_runs row and returns
 * it with the transient failures; counts and retries are in README.md#job-tags.
 */
export async function tagUntaggedJobs(db: Db, { sleep = pause } = {}) {
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
  const elapsedMs = () => Date.now() - startedAt.getTime();
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
  log("tagging-done", {
    tagged, defaulted_to_unknown: defaultedToUnknown, transient_failures: transientFailures,
    duration_ms: Date.now() - startedAt.getTime(),
  });
  const taggingRun = await recordSourceRun(db, {
    source: TAGGING_RUN_SOURCE, startedAt, finishedAt: new Date(),
    ok: error === null, seen: attempted, new: tagged, defaultedToUnknown, error,
  });
  return { taggingRun, transientFailures };
}
