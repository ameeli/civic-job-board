import { cronRouteHandler } from "@/lib/cron-route";
import { tagUntaggedJobs } from "@/lib/daily-check";
import { getDb } from "@/lib/db";

// Hobby plan maximum; see the README's "The daily check" section.
export const maxDuration = 300;

/** Tags untagged jobs and reports the tagging. */
export const GET = cronRouteHandler(
  { logEvent: "tagging-run-failed", message: "Job tagging failed; see the logs" },
  async () => {
    const { taggingRun, transientFailures } = await tagUntaggedJobs(getDb());
    const tagging = {
      ok: taggingRun.ok === true, tagged: taggingRun.new, defaulted: taggingRun.defaultedToUnknown,
      transient: transientFailures, ...(taggingRun.error === null ? {} : { error: taggingRun.error }),
    };
    return { ok: tagging.ok, runId: taggingRun.id, tagging };
  },
);
