import { isAuthorizedCronRequest } from "@civic-job-board/core";
import { after } from "next/server";
import { getDb } from "@/lib/db";
import { runDailyCheck, type DailyCheckSummary } from "@/lib/daily-check";

// Hobby plan maximum; see the README's "The daily check" section.
export const maxDuration = 300;

/** Work stops this long before the function's limit, leaving time to finish and to chain. */
const WORK_BUDGET_MS = 270_000;
/** A runaway chain (for example a source that always times out) stops after this many follow-up runs. */
const MAX_CHAINED_RUNS = 10;

/**
 * Daily check, invoked by Vercel Cron (see vercel.json). Polls every source,
 * stores new and changed jobs, and tags them with Gemini (see
 * `runDailyCheck`).
 *
 * When one run cannot finish within the time limit, it starts a fresh run
 * of itself (`?chain=N`, with the same secret) to continue. A chained run
 * answers 202 at once and works after responding, so the run that started
 * it is not kept waiting.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const chain = Math.max(0, Math.floor(Number(url.searchParams.get("chain") ?? "0")) || 0);
  const work = async (): Promise<DailyCheckSummary> => {
    const summary = await runDailyCheck({
      db: getDb(),
      fetch,
      deadline: new Date(Date.now() + WORK_BUDGET_MS),
      geminiApiKey: process.env.GEMINI_API_KEY || undefined,
      geminiModel: process.env.GEMINI_MODEL || undefined,
      aiRequestsPerMinute: Number(process.env.GEMINI_REQUESTS_PER_MINUTE) || undefined,
    });
    console.log(JSON.stringify({ dailyCheck: { chain, ...summary } }));
    if (summary.moreWork && chain < MAX_CHAINED_RUNS) {
      await startChainedRun(url.origin, chain + 1, secret!);
    }
    return summary;
  };

  if (chain > 0) {
    after(work);
    return Response.json({ ok: true, chain }, { status: 202 });
  }
  const summary = await work();
  return Response.json({ ok: true, ...summary });
}

async function startChainedRun(origin: string, chain: number, secret: string): Promise<void> {
  try {
    const response = await fetch(`${origin}/api/cron/daily?chain=${chain}`, {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 202) {
      console.error(`Chained daily check ${chain} answered HTTP ${response.status}`);
    }
  } catch (error) {
    // The next day's run picks up whatever is left.
    console.error(`Could not start chained daily check ${chain}:`, error);
  }
}
