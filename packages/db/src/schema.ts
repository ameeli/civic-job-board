import {
  bigint,
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * One row per check of one source, so the app can show when each source last
 * ran and whether it worked. `ok` and `finished_at` stay null while a run is
 * in progress.
 */
export const sourceRuns = pgTable("source_runs", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  source: text("source").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  ok: boolean("ok"),
  seen: integer("seen").notNull().default(0),
  new: integer("new").notNull().default(0),
  error: text("error"),
});

export type SourceRun = typeof sourceRuns.$inferSelect;
export type NewSourceRun = typeof sourceRuns.$inferInsert;
