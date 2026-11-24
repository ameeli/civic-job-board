import { desc, inArray } from "drizzle-orm";
import type { Db } from "./client";
import { sourceRuns, type NewSourceRun, type SourceRun } from "./schema";

export async function recordSourceRun(
  db: Db,
  run: NewSourceRun,
): Promise<SourceRun> {
  const [row] = await db.insert(sourceRuns).values(run).returning();
  if (!row) {
    throw new Error("Inserting a source_runs row returned nothing");
  }
  return row;
}

/** A source whose latest run started longer ago than this is reported as stale. */
export const STALE_SOURCE_AFTER_MS = 36 * 60 * 60 * 1000;

export type SourceProblems = {
  /** Sources whose latest run was recorded not ok, or left unfinished with an error. */
  failed: string[];
  /** Sources whose latest run started more than STALE_SOURCE_AFTER_MS before `now`. */
  stale: { source: string; lastStartedAt: Date }[];
};

/**
 * Problems with the given sources, judged by each one's most recent run. A
 * stale source is reported only as stale, since its last result is out of date.
 * A source with no runs yet is not listed.
 */
export async function readSourceProblems(
  db: Db,
  sources: readonly string[],
  now: Date,
): Promise<SourceProblems> {
  const problems: SourceProblems = { failed: [], stale: [] };
  if (sources.length === 0) return problems;
  const latestRuns = await db
    .selectDistinctOn([sourceRuns.source], {
      source: sourceRuns.source,
      startedAt: sourceRuns.startedAt,
      ok: sourceRuns.ok,
      error: sourceRuns.error,
    })
    .from(sourceRuns)
    .where(inArray(sourceRuns.source, [...sources]))
    .orderBy(sourceRuns.source, desc(sourceRuns.startedAt), desc(sourceRuns.id));
  for (const run of latestRuns) {
    if (now.getTime() - run.startedAt.getTime() > STALE_SOURCE_AFTER_MS) {
      problems.stale.push({ source: run.source, lastStartedAt: run.startedAt });
    } else if (run.ok === false || (run.ok === null && run.error !== null)) {
      problems.failed.push(run.source);
    }
  }
  return problems;
}
