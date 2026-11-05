import { recordSourceRun, saveListing, type Db, type JobListing, type SourceRun } from "@civic-job-board/db";
import { logDailyCheck as log } from "./daily-check-log";
import { errorMessage } from "./error-message";

export const NO_LISTINGS_ERROR = "No listings found";

/**
 * Checks one source: fetches its items, maps each to a listing and saves it in
 * turn, then records the check's source_runs row and returns it. `new` counts
 * the jobs this check created; a listing that joins an existing job is not new.
 * A fetch, mapping, or save failure ends this source's check and is recorded as
 * its error, while earlier saves remain. A fetch that returns no items is
 * recorded as a failure, since a board with no jobs is unlikely and an empty
 * result usually means its page changed shape. Failure to record the run still throws.
 */
export async function saveSourceListings<Item>(
  db: Db, source: string, fetchItems: () => Promise<Item[]>, mapListing: (item: Item) => JobListing,
): Promise<SourceRun> {
  const startedAt = new Date();
  log("source-start", { source });
  let seen = 0;
  let saved = 0;
  let newJobs = 0;
  let error: string | null = null;
  try {
    const items = await fetchItems();
    seen = items.length;
    if (seen === 0) throw new Error(NO_LISTINGS_ERROR);
    for (const item of items) {
      if (await saveListing(db, mapListing(item))) newJobs++;
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
