import { fetchGovRecords, GOV_SOURCE, mapGovJob } from "@civic-job-board/core";
import { recordSourceRun, saveJob, type Db } from "@civic-job-board/db";

/** One source check; successful saves remain available if a later listing fails. */
export async function dailyCheck(db: Db) {
  const startedAt = new Date();
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
