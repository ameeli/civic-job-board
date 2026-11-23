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

/**
 * The given sources whose most recent run failed: recorded not ok, or left
 * unfinished with an error. A source with no runs yet is not listed.
 */
export async function readFailingSources(
  db: Db,
  sources: readonly string[],
): Promise<string[]> {
  if (sources.length === 0) return [];
  const latestRuns = await db
    .selectDistinctOn([sourceRuns.source], {
      source: sourceRuns.source,
      ok: sourceRuns.ok,
      error: sourceRuns.error,
    })
    .from(sourceRuns)
    .where(inArray(sourceRuns.source, [...sources]))
    .orderBy(sourceRuns.source, desc(sourceRuns.startedAt), desc(sourceRuns.id));
  return latestRuns
    .filter((run) => run.ok === false || (run.ok === null && run.error !== null))
    .map((run) => run.source);
}
