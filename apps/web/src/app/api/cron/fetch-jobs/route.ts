import { cronRouteHandler } from "@/lib/cron-route";
import { fetchAndSaveJobs } from "@/lib/daily-check";
import { getDb } from "@/lib/db";

// Hobby plan maximum; see the README's "The daily check" section.
export const maxDuration = 300;

/** Fetches and saves every source's jobs and reports each source's check. */
export const GET = cronRouteHandler(
  { logEvent: "fetch-run-failed", message: "The job fetch failed; see the logs" },
  async () => {
    const sourceChecks = (await fetchAndSaveJobs(getDb())).map(sourceRun => ({
      source: sourceRun.source, runId: sourceRun.id,
      ok: sourceRun.ok === true, seen: sourceRun.seen, new: sourceRun.new,
      ...(sourceRun.error === null ? {} : { error: sourceRun.error }),
    }));
    return { ok: sourceChecks.every(check => check.ok), fetch: sourceChecks };
  },
);
