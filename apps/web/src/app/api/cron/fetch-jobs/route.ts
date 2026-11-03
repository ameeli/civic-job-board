import { isAuthorizedCronRequest } from "@civic-job-board/core";
import { fetchAndSaveJobs } from "@/lib/daily-check";
import { getDb } from "@/lib/db";

// Hobby plan maximum; see the README's "The daily check" section.
export const maxDuration = 300;

/** Fetches and saves jobs behind the cron secret and reports the fetch. */
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
    const sourceRun = await fetchAndSaveJobs(getDb());
    const fetch = {
      ok: sourceRun.ok === true, seen: sourceRun.seen, new: sourceRun.new,
      ...(sourceRun.error === null ? {} : { error: sourceRun.error }),
    };
    // A completed run answers 200 even when the fetch failed; the body says so.
    return Response.json({ ok: fetch.ok, runId: sourceRun.id, fetch });
  } catch (cause) {
    console.error("[daily-check] fetch-run-failed", cause);
    return Response.json({ ok: false, error: "The job fetch failed; see the logs" }, { status: 500 });
  }
}
