import { fetchGovRecords, GOV_SOURCE, mapGovJob } from "@civic-job-board/core/tech-jobs-for-gov";
import {
  buildTaggingRequest, MAX_JOBS_TAGGED_PER_RUN, PAUSE_BETWEEN_TAGGING_REQUESTS_MS, readTaggingAnswer,
  TAGGING_MODEL, TAGGING_RUN_SOURCE,
} from "@civic-job-board/core/job-tags";
import { readJobsToTag, recordSourceRun, saveJob, saveJobTags, type Db } from "@civic-job-board/db";

const GEMINI_API = `https://generativelanguage.googleapis.com/v1beta/models/${TAGGING_MODEL}:generateContent`;
const GEMINI_TIMEOUT_MS = 20_000;
/** No tagging request starts later than this after the run began, so it ends inside the 300 s limit. */
const LAST_TAGGING_REQUEST_AFTER_MS = 260_000;

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The source check, then Gemini tagging of untagged jobs. Each records its own
 * source_runs row; the source check's row is returned for the cron response.
 */
export async function dailyCheck(db: Db, { sleep = pause } = {}) {
  const startedAt = new Date();
  const sourceRun = await checkTechJobsForGov(db, startedAt);
  await tagUntaggedJobs(db, startedAt, sleep);
  return sourceRun;
}

/** One source check; successful saves remain available if a later listing fails. */
async function checkTechJobsForGov(db: Db, startedAt: Date) {
  let seen = 0;
  let newJobs = 0;
  let error: string | null = null;
  try {
    const records = await fetchGovRecords();
    seen = records.length;
    for (const record of records) {
      const job = mapGovJob(record);
      if (await saveJob(db, job)) newJobs++;
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  return recordSourceRun(db, {
    source: GOV_SOURCE, startedAt, finishedAt: new Date(),
    ok: error === null, seen, new: newJobs, error,
  });
}

/** Tags the backlog; run counts and retry behavior are documented in README.md#job-tags. */
async function tagUntaggedJobs(db: Db, checkStartedAt: Date, sleep: (ms: number) => Promise<unknown>) {
  const startedAt = new Date();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return recordSourceRun(db, {
      source: TAGGING_RUN_SOURCE, startedAt, finishedAt: new Date(), ok: false,
      error: "GEMINI_API_KEY is not set; tagging skipped",
    });
  }
  let sent = 0;
  let tagged = 0;
  let defaultedToUnknown = 0;
  let error: string | null = null;
  for (const job of await readJobsToTag(db, MAX_JOBS_TAGGED_PER_RUN)) {
    if (sent > 0) await sleep(PAUSE_BETWEEN_TAGGING_REQUESTS_MS);
    if (Date.now() - checkStartedAt.getTime() > LAST_TAGGING_REQUEST_AFTER_MS) break;
    sent++;
    try {
      const response = await fetch(GEMINI_API, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(buildTaggingRequest(job)),
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Gemini: HTTP ${response.status}`);
      // Keep body-read failures outside the parse catch so interrupted responses remain retryable.
      const body = await response.text();
      let answer: unknown;
      try {
        answer = JSON.parse(body);
      } catch {
        answer = null;
      }
      const { tags, defaultedToUnknown: defaulted } = readTaggingAnswer(answer);
      if (!await saveJobTags(db, job.id, tags)) continue;
      tagged++;
      if (defaulted) defaultedToUnknown++;
    } catch (cause) {
      error ??= cause instanceof Error ? cause.message : String(cause);
    }
  }
  return recordSourceRun(db, {
    source: TAGGING_RUN_SOURCE, startedAt, finishedAt: new Date(),
    ok: error === null, seen: sent, new: tagged, defaultedToUnknown, error,
  });
}
