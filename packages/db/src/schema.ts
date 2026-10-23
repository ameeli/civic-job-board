import type { BoardTag, RemoteType, SalaryPeriod } from "@civic-job-board/core";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

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
  /**
   * True when the run's time ran out before every new job was read; the
   * next run of the daily check picks up the rest.
   */
  partial: boolean("partial").notNull().default(false),
});

export type SourceRun = typeof sourceRuns.$inferSelect;
export type NewSourceRun = typeof sourceRuns.$inferInsert;

/**
 * Employers. One employer can be written many ways across sources, so
 * `aliases` holds every key it has been matched by: `name:<normalized name>`
 * and `ats:<provider>:<account>` for the employer's account on an
 * applicant tracking system. `domain` is the employer's own website domain
 * when a source gave it; several employers can share one (agencies of one
 * government, for example), so it is not unique.
 */
export const organizations = pgTable(
  "organizations",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    name: text("name").notNull(),
    domain: text("domain"),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("organizations_aliases_idx").using("gin", table.aliases),
    index("organizations_domain_idx").on(table.domain),
  ],
);

export type JobStatus = "open" | "closed";
export type ClosedReason = "expired" | "gone";

/**
 * Canonical jobs: one row per real job, however many sources list it. The
 * fields are merged from the job's sightings (see `job_sightings`). Jobs are
 * never deleted; a closed job keeps its row. Page copies have a separate
 * retention policy (see `trimPageCopies`).
 */
export const jobs = pgTable(
  "jobs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: bigint("organization_id", { mode: "number" }).references(
      () => organizations.id,
    ),
    title: text("title").notNull(),
    location: text("location"),
    remoteType: text("remote_type").$type<RemoteType>(),
    salaryMin: doublePrecision("salary_min"),
    salaryMax: doublePrecision("salary_max"),
    salaryCurrency: text("salary_currency"),
    salaryPeriod: text("salary_period").$type<SalaryPeriod>(),
    description: text("description"),
    applyUrl: text("apply_url"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: text("status").$type<JobStatus>().notNull().default("open"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedReason: text("closed_reason").$type<ClosedReason>(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    /** One-line summary written by the AI step. */
    summary: text("summary"),
    /** Set when the AI step last tagged the job. */
    aiTaggedAt: timestamp("ai_tagged_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("jobs_status_idx").on(table.status),
    index("jobs_organization_id_idx").on(table.organizationId),
    index("jobs_closed_at_idx").on(table.closedAt),
    check("jobs_status_check", sql`${table.status} in ('open', 'closed')`),
  ],
);

/** A source's own description of a job, as stored in `job_sightings.data`. */
export interface SightingData {
  title: string;
  orgName: string | null;
  orgWebsite: string | null;
  location: string | null;
  remoteType: RemoteType | null;
  salary: {
    min: number | null;
    max: number | null;
    currency: string | null;
    period: SalaryPeriod;
  } | null;
  description: string | null;
  applyUrl: string | null;
  /** ISO 8601. */
  postedAt: string | null;
  /** ISO 8601. */
  expiresAt?: string | null;
  boardTags: BoardTag[];
}

/**
 * Each place a job was found: one row per (source, the source's own id).
 * Several sightings of one job, on different boards and newsletters, point
 * at one `jobs` row. `link_keys` (normalized links and ATS ids) is how a
 * new sighting finds the job it belongs to.
 *
 * Closure: a source with a full listing marks a sighting missing on each
 * check it is absent from (`missed_checks`); after several, or for feeds
 * that show only recent jobs, after a long absence, `gone_at` is set. A job
 * closes when all its sightings are gone.
 */
export const jobSightings = pgTable(
  "job_sightings",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    jobId: bigint("job_id", { mode: "number" })
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    organizationId: bigint("organization_id", { mode: "number" }).references(
      () => organizations.id,
    ),
    linkKeys: text("link_keys").array().notNull().default(sql`'{}'::text[]`),
    data: jsonb("data").$type<SightingData>().notNull(),
    /** The source's change marker, such as a last-modified time. */
    version: text("version"),
    /** How the source found the job, such as `around the web`. */
    via: text("via"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    missedChecks: integer("missed_checks").notNull().default(0),
    /** When a full-listing check last counted this sighting present or missing. */
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    goneAt: timestamp("gone_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("job_sightings_source_external_id_idx").on(table.source, table.externalId),
    index("job_sightings_job_id_idx").on(table.jobId),
    index("job_sightings_link_keys_idx").using("gin", table.linkKeys),
  ],
);

export type TagOrigin = "board" | "ai";

/**
 * Labels on a job. Board tags (`origin = 'board'`) are the categories the
 * sources themselves use, with the source's own axis names (`category`,
 * `impact_area`, ...). AI tags (`origin = 'ai'`) use the app's taxonomy on
 * the axes `function`, `sector`, and `seniority`, with the model's
 * confidence.
 */
export const jobTags = pgTable(
  "job_tags",
  {
    jobId: bigint("job_id", { mode: "number" })
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    origin: text("origin").$type<TagOrigin>().notNull(),
    axis: text("axis").notNull(),
    tag: text("tag").notNull(),
    confidence: real("confidence"),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.origin, table.axis, table.tag] }),
    index("job_tags_axis_tag_idx").on(table.axis, table.tag),
  ],
);

/** Jobs waiting for the AI step. A row is removed once the job is tagged. */
export const aiQueue = pgTable("ai_queue", {
  jobId: bigint("job_id", { mode: "number" })
    .primaryKey()
    .references(() => jobs.id, { onDelete: "cascade" }),
  enqueuedAt: timestamp("enqueued_at", { withTimezone: true }).notNull().defaultNow(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  /** Not retried before this time, after a failure. */
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Copies of public job pages (scripts and styles stripped), one per
 * sighting, so a job can be re-read after the source drops it. Copies of
 * jobs closed more than 90 days ago are deleted by the daily check; the job
 * itself is kept.
 */
export const pageCopies = pgTable(
  "page_copies",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    jobId: bigint("job_id", { mode: "number" })
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    sightingId: bigint("sighting_id", { mode: "number" })
      .notNull()
      .references(() => jobSightings.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    html: text("html").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("page_copies_sighting_id_idx").on(table.sightingId),
    index("page_copies_job_id_idx").on(table.jobId),
  ],
);

/**
 * Short-lived locks so that two deliveries of the daily check (Vercel can
 * deliver a cron twice) never run at the same time.
 */
export const runLeases = pgTable("run_leases", {
  name: text("name").primaryKey(),
  holder: text("holder").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type Organization = typeof organizations.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type JobSighting = typeof jobSightings.$inferSelect;
export type JobTag = typeof jobTags.$inferSelect;

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
