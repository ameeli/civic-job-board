import { isAuthorizedCronRequest } from "@civic-job-board/core";
import { tagUntaggedJobs } from "@/lib/daily-check";
import { getDb } from "@/lib/db";

// Hobby plan maximum; see the README's "The daily check" section.
export const maxDuration = 300;

/** Tags untagged jobs behind the cron secret and reports the tagging. */
export async function GET(request: Request): Promise<Response> {
  if (
    !isAuthorizedCronRequest(
      request.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { taggingRun, transientFailures } = await tagUntaggedJobs(getDb());
    const tagging = {
      ok: taggingRun.ok === true, tagged: taggingRun.new, defaulted: taggingRun.defaultedToUnknown,
      transient: transientFailures, ...(taggingRun.error === null ? {} : { error: taggingRun.error }),
    };
    // A completed run answers 200 even when tagging failed; the body says so.
    return Response.json({ ok: tagging.ok, runId: taggingRun.id, tagging });
  } catch (cause) {
    console.error("[daily-check] tagging-run-failed", cause);
    return Response.json({ ok: false, error: "Job tagging failed; see the logs" }, { status: 500 });
  }
}
