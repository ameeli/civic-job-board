import { and, eq, lte, or, sql } from "drizzle-orm";
import { runLeases } from "./schema";
import type { Db } from "./source-runs";

/**
 * Takes the named lease until `expiresAt`, unless someone else holds an
 * unexpired one. Returns whether this holder now has it. A holder that
 * crashed simply lets its lease expire.
 */
export async function acquireLease(
  db: Db,
  input: { name: string; holder: string; expiresAt: Date; now: Date },
): Promise<boolean> {
  const rows = await db
    .insert(runLeases)
    .values({ name: input.name, holder: input.holder, expiresAt: input.expiresAt })
    .onConflictDoUpdate({
      target: runLeases.name,
      set: { holder: input.holder, expiresAt: input.expiresAt },
      setWhere: or(lte(runLeases.expiresAt, input.now), eq(runLeases.holder, sql`excluded.holder`)),
    })
    .returning({ name: runLeases.name });
  return rows.length > 0;
}

export async function releaseLease(db: Db, input: { name: string; holder: string }): Promise<void> {
  await db
    .delete(runLeases)
    .where(and(eq(runLeases.name, input.name), eq(runLeases.holder, input.holder)));
}
