import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { sourceRuns, type NewSourceRun, type SourceRun } from "./schema";

export type Db = PgDatabase<PgQueryResultHKT>;

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
 * The sources that already finished a full check since `since`, successful
 * or not. A partial check (cut short by the time limit) does not count, so
 * the next run continues it.
 */
export async function sourcesCheckedSince(db: Db, since: Date): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ source: sourceRuns.source })
    .from(sourceRuns)
    .where(
      and(
        gte(sourceRuns.startedAt, since),
        isNotNull(sourceRuns.finishedAt),
        eq(sourceRuns.partial, false),
      ),
    );
  return new Set(rows.map((row) => row.source));
}

/**
 * Each source's most recent finished check, for the banner that names
 * sources that failed or found nothing.
 */
export async function latestSourceRuns(db: Db): Promise<SourceRun[]> {
  return db
    .selectDistinctOn([sourceRuns.source])
    .from(sourceRuns)
    .where(isNotNull(sourceRuns.finishedAt))
    .orderBy(sourceRuns.source, desc(sourceRuns.startedAt), desc(sourceRuns.id));
}
