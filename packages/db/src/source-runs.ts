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
