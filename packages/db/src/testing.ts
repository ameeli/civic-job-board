import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "./source-runs";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

/** For tests: an in-memory Postgres with the real migrations applied. */
export async function createTestDb(): Promise<Db> {
  const db = drizzle({ client: new PGlite() });
  await migrate(db, { migrationsFolder });
  return db;
}
