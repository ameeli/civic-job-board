import { recordSourceRun, saveJob, type Db, type NewJob, type SourceRun } from "@civic-job-board/db";
import { logDailyCheck as log } from "./daily-check-log";
import { errorMessage } from "./error-message";

/**
 * Checks one source: fetches its listings, maps and saves each in turn, then
 * records the check's source_runs row and returns it. A fetch, mapping, or save
 * failure ends this source's check and is recorded as its error, while earlier
 * saves remain; it never throws for the source's own failures.
 */
export async function saveSourceJobs<Listing>(
  db: Db, source: string, fetchListings: () => Promise<Listing[]>, mapJob: (listing: Listing) => NewJob,
): Promise<SourceRun> {
  const startedAt = new Date();
  log("source-start", { source });
  let seen = 0;
  let saved = 0;
  let newJobs = 0;
  let error: string | null = null;
  try {
    const listings = await fetchListings();
    seen = listings.length;
    for (const listing of listings) {
      if (await saveJob(db, mapJob(listing))) newJobs++;
      saved++;
    }
  } catch (cause) {
    error = errorMessage(cause);
  }
  log("source-done", {
    source, ok: error === null, fetched: seen, saved, new: newJobs,
    ...(error === null ? {} : { error }), duration_ms: Date.now() - startedAt.getTime(),
  });
  return recordSourceRun(db, {
    source, startedAt, finishedAt: new Date(),
    ok: error === null, seen, new: newJobs, error,
  });
}
