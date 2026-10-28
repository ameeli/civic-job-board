import { fetchGovApplyLink, fetchGovRecords, GOV_SOURCE, planGovJob } from "@civic-job-board/core";
import { readSourceJobs, recordSourceRun, saveJob, type Db } from "@civic-job-board/db";

/** One source check; successful saves remain available if a later listing fails. */
export async function dailyCheck(db: Db) {
  const startedAt = new Date();
  let seen = 0;
  let newJobs = 0;
  let error: string | null = null;
  try {
    const known = new Map<string, { applyUrl: string | null }>((await readSourceJobs(db, GOV_SOURCE)).map(job => [job.sourceJobId, job]));
    const records = await fetchGovRecords();
    seen = records.length;
    for (const record of records) {
      const plan = planGovJob(record, known.get(String(record.id)));
      if (plan.needsPage) plan.job.applyUrl = await fetchGovApplyLink(plan.job.sourceUrl);
      if (await saveJob(db, plan.job)) newJobs++;
      known.set(plan.job.sourceJobId, plan.job);
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  return recordSourceRun(db, {
    source: GOV_SOURCE, startedAt, finishedAt: new Date(),
    ok: error === null, seen, new: newJobs, error,
  });
}
