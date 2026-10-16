import { createDb, type Db } from "@civic-job-board/db";
import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";

let db: Db | undefined;

/** Lazily creates one pooled connection per function instance. */
export function getDb(): Db {
  if (!db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    const pool = new Pool({ connectionString });
    // Lets Vercel Fluid compute close idle connections before suspending the instance.
    attachDatabasePool(pool);
    db = createDb(pool);
  }
  return db;
}
