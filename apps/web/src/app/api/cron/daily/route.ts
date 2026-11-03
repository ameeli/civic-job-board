import { isAuthorizedCronRequest } from "@civic-job-board/core";
import { dailyCheck } from "@/lib/daily-check";
import { getDb } from "@/lib/db";

// Hobby plan maximum; see the README's "The daily check" section.
export const maxDuration = 300;

/** Runs the daily check behind the cron secret and reports each part. */
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
    const { sourceRun, taggingRun, transientFailures } = await dailyCheck(getDb());
    const fetch = {
      ok: sourceRun.ok === true, seen: sourceRun.seen, new: sourceRun.new,
      ...(sourceRun.error === null ? {} : { error: sourceRun.error }),
    };
    const tagging = {
      ok: taggingRun.ok === true, tagged: taggingRun.new, defaulted: taggingRun.defaultedToUnknown,
      transient: transientFailures, ...(taggingRun.error === null ? {} : { error: taggingRun.error }),
    };
    // A completed run answers 200 even when a part failed; the body says which part.
    return Response.json({ ok: fetch.ok && tagging.ok, runId: sourceRun.id, fetch, tagging });
  } catch (cause) {
    console.error("[daily-check] run-failed", cause);
    return Response.json({ ok: false, error: "The daily check failed; see the logs" }, { status: 500 });
  }
}
