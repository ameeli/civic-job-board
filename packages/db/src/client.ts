import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { Pool } from "pg";

/** A Drizzle Postgres database: node-postgres in the app, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT>;

export function createDb(pool: Pool) {
  return drizzle({ client: pool });
}
