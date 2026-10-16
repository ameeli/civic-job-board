import { isAuthorizedCronRequest } from "@civic-job-board/core";
import { recordSourceRun } from "@civic-job-board/db";
import { getDb } from "@/lib/db";

// Hobby plan maximum; see the README's "Daily check" section.
export const maxDuration = 300;

/**
 * Daily check, invoked by Vercel Cron (see vercel.json). There are no sources
 * yet, so it only records that the run happened.
 */
export async function GET(request: Request): Promise<Response> {
  if (
    !isAuthorizedCronRequest(
      request.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  const run = await recordSourceRun(getDb(), {
    source: "daily",
    startedAt,
    finishedAt: new Date(),
    ok: true,
  });

  return Response.json({ ok: true, runId: run.id });
}
