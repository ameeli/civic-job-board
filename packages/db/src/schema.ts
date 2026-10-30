import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * One row per check of one source, so the app can show when each source last
 * ran and whether it worked.
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
  // Tagging runs only: tagged jobs whose answer lacked a valid role, sector, or seniority.
  defaultedToUnknown: integer("defaulted_to_unknown").notNull().default(0),
});

export type SourceRun = typeof sourceRuns.$inferSelect;
export type NewSourceRun = typeof sourceRuns.$inferInsert;

// The tables below are the ones Better Auth needs (users, sessions, accounts,
// verifications). Their TypeScript property names are Better Auth's field
// names; the adapter maps them to these snake_case columns.

/**
 * People who can sign in. Every per-user table references `users.id`, so a
 * second person could be added later without changing those tables.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** Signed-in browser sessions; the session cookie holds `token`. */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

/**
 * Sign-in methods linked to a user: one row per Google account. `password`
 * is part of Better Auth's schema but stays null because only Google sign-in
 * is enabled.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    accountId: text("account_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("accounts_user_id_idx").on(table.userId),
    uniqueIndex("accounts_provider_account_idx").on(
      table.providerId,
      table.accountId,
    ),
  ],
);

/** Short-lived values Better Auth stores during sign-in flows. */
export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

export type User = typeof users.$inferSelect;

/** The tables Better Auth's Drizzle adapter reads and writes. */
export const authSchema = { users, sessions, accounts, verifications };

/** Source listings are retained even when they disappear from the board. */
export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull(),
  sourceJobId: text("source_job_id").notNull(),
  title: text("title").notNull(),
  employerName: text("employer_name"),
  location: text("location"),
  salary: text("salary"),
  description: text("description").notNull(),
  applyUrl: text("apply_url"),
  sourceUrl: text("source_url").notNull(),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  deadline: text("deadline"),
  // Gemini's tags; all null until the job is tagged, which happens once.
  roleTags: text("role_tags").array(),
  sectorTags: text("sector_tags").array(),
  seniority: text("seniority"),
  summary: text("summary"),
  taggedAt: timestamp("tagged_at", { withTimezone: true }),
}, (table) => [uniqueIndex("jobs_source_id_idx").on(table.source, table.sourceJobId)]);

export type NewJob = typeof jobs.$inferInsert;
