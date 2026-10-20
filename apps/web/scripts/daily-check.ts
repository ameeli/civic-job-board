/**
 * Runs the daily check once from your computer, against DATABASE_URL, with
 * no time limit. Reads apps/web/.env.local when it exists.
 *
 *   pnpm daily-check            # sources not checked in the last 20 hours, then AI
 *   pnpm daily-check --force    # every source, even if checked today
 */
import { createDb } from "@civic-job-board/db";
import { Pool } from "pg";
import { runDailyCheck } from "../src/lib/daily-check";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set (put it in apps/web/.env.local or export it).");
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.warn("GEMINI_API_KEY is not set: new jobs stay queued for AI tagging.");
}

const pool = new Pool({ connectionString });
try {
  const summary = await runDailyCheck({
    db: createDb(pool),
    fetch,
    // Locally there is no function time limit; an hour covers a first run.
    deadline: new Date(Date.now() + 3_600_000),
    geminiApiKey: process.env.GEMINI_API_KEY || undefined,
    geminiModel: process.env.GEMINI_MODEL || undefined,
    aiRequestsPerMinute: Number(process.env.GEMINI_REQUESTS_PER_MINUTE) || undefined,
    force: process.argv.includes("--force"),
  });
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.status === "busy" ? 1 : 0;
} finally {
  await pool.end();
}
