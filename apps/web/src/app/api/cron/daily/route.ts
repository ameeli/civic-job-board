import { isAuthorizedCronRequest } from "@civic-job-board/core";
import { dailyCheck } from "@/lib/daily-check";
import { getDb } from "@/lib/db";

// Hobby plan maximum; see the README's "The daily check" section.
export const maxDuration = 300;

/** Run the source check using the existing guarded cron entry point. */
export async function GET(request: Request): Promise<Response> {
  if (
    !isAuthorizedCronRequest(
      request.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const run = await dailyCheck(getDb());
  return Response.json({ ok: run.ok, runId: run.id }, { status: run.ok ? 200 : 502 });
}
