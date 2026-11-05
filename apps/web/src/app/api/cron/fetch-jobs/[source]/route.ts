import { cronRouteHandler } from "@/lib/cron-route";
import { fetchAndSaveSource, isJobSource } from "@/lib/daily-check";
import { getDb } from "@/lib/db";

// Hobby plan maximum; see the README's "The daily check" section.
export const maxDuration = 300;

const failure = { logEvent: "fetch-run-failed", message: "The job fetch failed; see the logs" };

/** Fetches and saves the named source's jobs and reports its check; other names answer 404. */
export async function GET(request: Request, { params }: RouteContext<"/api/cron/fetch-jobs/[source]">) {
  const { source } = await params;
  return cronRouteHandler(failure, async () => {
    if (!isJobSource(source)) return Response.json({ ok: false, error: "Unknown source" }, { status: 404 });
    const sourceRun = await fetchAndSaveSource(getDb(), source);
    const fetch = {
      source: sourceRun.source, ok: sourceRun.ok === true, seen: sourceRun.seen, new: sourceRun.new,
      ...(sourceRun.error === null ? {} : { error: sourceRun.error }),
    };
    return { ok: fetch.ok, runId: sourceRun.id, fetch };
  })(request);
}
