# civic-job-board

Unified inbox-style job board for civic tech and tech-for-good roles.

A personal, single-user app that checks civic job boards and newsletters once a
day and merges the jobs it finds into one email-style inbox.

So far it deploys, has Google sign-in locked to the owner's account, and runs
a daily check that reads five job sources, merges duplicate jobs, and tags
every new job with Gemini (see [The daily check](#the-daily-check)). The inbox
UI is not built yet; screens and visual design are being prototyped
separately.

To put it online, follow [`docs/deploy.md`](docs/deploy.md).

## Stack and why

Hosting must cost **0 USD/month**, so every piece fits a free tier:

| Piece | Choice | Why |
| --- | --- | --- |
| Web app, server functions, daily check | [Vercel](https://vercel.com) Hobby plan, Next.js App Router | Free; one platform runs the UI, the API routes, and the built-in [cron](https://vercel.com/docs/cron-jobs). |
| Database | [Neon](https://neon.com) Free Postgres | Free serverless Postgres that pairs with Vercel. |
| Sign-in | [Better Auth](https://www.better-auth.com) with Google | Free library; sessions live in the app's own Neon database. See [Login](#login). |
| AI | Google Gemini free tier (`gemini-3.5-flash-lite`) | Free; tags each new job's role and sector and writes a one-line summary. See [AI tags](#ai-tags). |
| Email-only newsletters (later) | A dedicated Gmail account + Google Apps Script | Free; the script forwards new mail to the app. See [`apps-script/`](apps-script/README.md). |

Supabase, Cloudflare, Render, and GitHub Actions scheduling are deliberately not
used. GitHub Actions only runs CI.

### Repository layout

```
apps/web/        Next.js app deployed to Vercel (sign-in, placeholder home page, daily cron route,
                 and the local daily-check script in scripts/)
packages/core/   Runtime-agnostic shared code (no Node or browser APIs): source adapters, Gemini client
packages/db/     Drizzle schema, SQL migrations, and database helpers (storing, merging, closing jobs)
apps-script/     Placeholder for the future Gmail forwarding script
```

It is a pnpm workspace. Workspace packages export their TypeScript source
directly; Next.js compiles them through `transpilePackages`.

### Database access: Drizzle

Typed SQL and migrations use [Drizzle ORM](https://orm.drizzle.team) with
[drizzle-kit](https://orm.drizzle.team/docs/kit-overview), chosen over Kysely
because the TypeScript schema in `packages/db/src/schema.ts` is the single
source of truth: query types come from it and drizzle-kit generates plain,
reviewable SQL migrations from it. Kysely would need its types and its
migrations written or generated separately. Drizzle also has first-class
Postgres drivers for both Neon and local Postgres, and an in-memory
[PGlite](https://pglite.dev) driver the unit tests use to apply the real
migrations without a database server.

The app connects with [node-postgres](https://node-postgres.com) (`pg`). Vercel
Functions run on [Fluid compute](https://vercel.com/docs/fluid-compute), where a
normal connection pool is reused across requests, and `attachDatabasePool` from
`@vercel/functions` closes idle connections before an instance suspends. The same
driver works against Neon and any local Postgres.

## Local setup

Requirements: Node.js 24 (see `.nvmrc`) and pnpm 10. `corepack enable` installs
the pnpm version pinned in `package.json`.

```sh
pnpm install
cp .env.example apps/web/.env.local    # then fill in the values (see below)
```

Commands, all run from the repository root:

| Command | What it does |
| --- | --- |
| `pnpm dev` | Runs the web app at http://localhost:3000 |
| `pnpm build` | Production build of the web app |
| `pnpm lint` | ESLint over the whole repository |
| `pnpm typecheck` | TypeScript in every package |
| `pnpm test` | Vitest unit tests in every package (no database needed) |
| `pnpm db:generate` | Generates a new SQL migration after editing `packages/db/src/schema.ts` |
| `pnpm db:migrate` | Applies pending migrations to `DATABASE_URL` |
| `pnpm daily-check` | Runs the daily check once against `DATABASE_URL` (see below) |

Signing in locally needs the Google client from
[`docs/deploy.md`](docs/deploy.md#step-4-create-the-google-oauth-client), whose
redirect URIs include `http://localhost:3000`, and
`BETTER_AUTH_URL=http://localhost:3000`.

`pnpm dev` loads `apps/web/.env.local`; `pnpm db:migrate` does not read any
`.env` file, so export `DATABASE_URL` in your shell (or prefix the command) when
running it. Any Postgres works
locally, for example:

```sh
docker run -d --name civic-pg -e POSTGRES_PASSWORD=pw -p 5432:5432 postgres:17
export DATABASE_URL=postgres://postgres:pw@localhost:5432/postgres
pnpm db:migrate
```

To run the daily check by hand (Vercel does not run crons in local dev), put
`DATABASE_URL` and, for AI tags, `GEMINI_API_KEY` in `apps/web/.env.local`
(or export them), then:

```sh
pnpm daily-check            # sources not checked in the last 20 hours, then AI tagging
pnpm daily-check --force    # every source, even one already checked today
```

It has no time limit, so it finishes in one go (a first run on an empty
database takes about seven minutes; later runs take seconds) and prints a
summary. Without `GEMINI_API_KEY`, new jobs wait in the AI queue for a later
run. To exercise the route the cron calls instead, set `CRON_SECRET`, run the
app, and call it:

```sh
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/daily
```

## Environment variables

Listed in [`.env.example`](.env.example). This repository is public: never
commit real values. Every `.env*` file except `.env.example` is gitignored.

| Variable | Used by | Value |
| --- | --- | --- |
| `DATABASE_URL` | App, `db:migrate` | Postgres connection string. On Neon, use the pooled connection string. |
| `CRON_SECRET` | Daily check | Random string of at least 16 characters. Vercel sends it as `Authorization: Bearer <CRON_SECRET>` on every cron request; the route rejects all requests when it is unset. |
| `ALLOWED_EMAIL` | Sign-in | The one Google account that may sign in, compared case-insensitively. Nobody can sign in when it is unset. |
| `BETTER_AUTH_SECRET` | Sign-in | Random string of at least 32 characters (`openssl rand -base64 32`) that signs session cookies. |
| `BETTER_AUTH_URL` | Sign-in | The app's own address without a trailing slash, such as `http://localhost:3000` or `https://civic-job-board.vercel.app`. Google's redirect URI is this plus `/api/auth/callback/google`. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Sign-in | The Google OAuth client; see [`docs/deploy.md`](docs/deploy.md#step-4-create-the-google-oauth-client). |
| `GEMINI_API_KEY` | Daily check | Google Gemini API key ([`docs/deploy.md`](docs/deploy.md#create-the-gemini-api-key)). When unset, the check still runs and new jobs wait untagged. |
| `GEMINI_MODEL` | Daily check | Optional. Overrides the model, `gemini-3.5-flash-lite`. |
| `GEMINI_REQUESTS_PER_MINUTE` | Daily check | Optional. Gemini requests per minute, default 10 (each tags up to 5 jobs). |

In production, set them in the Vercel project's environment variables
([`docs/deploy.md`](docs/deploy.md#step-5-set-the-environment-variables-in-vercel)).

## Deploys

Vercel deploys from GitHub. [`docs/deploy.md`](docs/deploy.md) walks through the
first deploy step by step (Neon project, migrations, Vercel project, Google
client, environment variables, and checks). In short:

- Create a Vercel project from this repository and set its **Root Directory**
  to `apps/web`. Vercel detects Next.js and the pnpm workspace and installs from
  the repository root.
- Pushes to `main` create production deployments; pull requests get preview
  deployments.
- Run `pnpm db:migrate` against the Neon database before deploying code that
  needs a new migration.

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs
lint, typecheck, tests, and a build on every pull request and push to `main`.

## The daily check

[`apps/web/vercel.json`](apps/web/vercel.json) schedules one cron job that calls
`GET /api/cron/daily` once a day at `0 13 * * *` UTC: 6 am Pacific in summer
(PDT) and 5 am in winter (PST). The route checks the `CRON_SECRET` bearer
header and runs the check
([`apps/web/src/lib/daily-check.ts`](apps/web/src/lib/daily-check.ts)):

1. **Poll every source** that has not finished a check in the last 20 hours,
   and record one `source_runs` row per source: `ok`, `seen` (jobs the source
   lists now), `new` (jobs it had not listed before), `error`, and `partial`.
   The inbox banner (a later step) names each source whose latest row failed
   or saw nothing.
2. **Store** each job as a sighting and merge duplicates into one canonical
   job (see [Duplicates](#duplicates)).
3. **Close and reopen** jobs (see [Closing jobs](#closing-jobs)), and delete
   page copies of jobs closed more than 90 days ago.
4. **Tag** queued jobs with Gemini (see [AI tags](#ai-tags)).

The check is safe if Vercel misses a day or delivers it twice: a lease in
`run_leases` keeps two runs from overlapping, sources already checked in the
last 20 hours are skipped, storing a check twice changes nothing, and every
source is read in a way that catches up on missed days.

### Sources

Each source has an adapter in
[`packages/core/src/sources/`](packages/core/src/sources/) that turns it into
one job shape: title, employer and its website, location, remote/hybrid/on
site, pay (with unit sanity checks), description, apply link, source link,
the source's own id, posted and closing dates, and the source's own category
tags. Adapters are tested against saved copies of each source in
`packages/core/src/sources/fixtures/`. Every endpoint was checked live on
2026-10-20.

| Source | What is read |
| --- | --- |
| Tech Jobs for Gov | The WordPress REST API (`civicworkstudio.com/wp-json/wp/v2/job-listings`). Each check lists every open job's id and last-modified time, fetches full records only for new or changed jobs, and fetches those jobs' pages for the apply link, which the API lacks. |
| Tech Jobs for Good | Free listings only, never premium-only jobs. The public listing (`/jobs/?page=N`, about 100 jobs) decides which jobs to take, and each new one's page is read once. The sitemap lists every open job, free or premium, and only tells when a job closes (a free job that moves behind the paywall is still open). The RSS feed has only the five newest jobs, all on the free listing, so it is not read. |
| Diversify Tech (board) | The job sitemap, then each new job's page (its JSON-LD plus the job record the page embeds), at most one request a second as its robots.txt asks. |
| Diversify Tech (newsletter) | Its public beehiiv RSS feed. Each issue's JOBS section is split into one job per line, labelled `job board` or `around the web`. |
| DSCovery | Its RSS feed (`dscovery.fly.dev/feed/jobs`) has only the 50 newest jobs, so the home page's full job table is read too, for every open job with its employer, practice area, and location. Each new job's application page is read once for its description. |
| Civic Tech Field Guide | Its jobs RSS feed, the 100 newest jobs. The feed has no employer field, so the employer comes from each job's application page (schema.org `JobPosting`), else a title such as "Data Scientist at Candid", else the employer's ATS account, else the AI step. Field Guide data is licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) and must be credited wherever it is shown (`attribution` on the adapter). |
| Field Guide Friday (newsletter) | Its public Mailchimp archive RSS feed: each issue's "Open Jobs" section, one job per paragraph. |

Newsletters are read three weeks back on every check, so a missed day loses
nothing. Pages fetched for a new job are kept in `page_copies`, with scripts
and styles removed.

### Duplicates

A new sighting joins an existing job, in order of certainty, when it has:

1. the same ATS job id (Greenhouse, Lever, Ashby, Workday, and others,
   whatever the link style) or board job id, or the same normalized link and
   a similar title; or
2. the same employer, a very similar title (trigram similarity of at least
   0.7, computed like Postgres `pg_trgm`), and compatible pay and remote
   type.

A job never takes a second sighting from the same source. Each field of the
merged job comes from the first source that has it, in the order of
`SOURCES` in
[`packages/core/src/sources/index.ts`](packages/core/src/sources/index.ts).
Employers (`organizations`) are matched by normalized name. A job with no
employer name is matched by its ATS account, but only when exactly one known
employer uses that account, because many government agencies share one.

### Closing jobs

Jobs, and everything attached to them, are kept forever; closing only sets
`status` to `closed` and `closed_at`. A job closes when:

- its application deadline day has passed, or
- every source that listed it has dropped it: a source with a full listing
  after missing it on 3 daily checks; a feed or newsletter, which only shows
  recent jobs, after 30 days without it.

A closed job that a source lists again, with no passed deadline, reopens. A
full listing that comes back empty is treated as a broken source, not as
every job closing.

### AI tags

New jobs go into the `ai_queue` table. After the sources, the check sends
them to Gemini in batches of five, at most 10 requests a minute, and stores
for each job one function tag, one to three sector tags, a seniority, and a
one-line summary, from the taxonomy in
[`packages/core/src/ai/taxonomy.ts`](packages/core/src/ai/taxonomy.ts). AI
tags (`origin = 'ai'`, with the model's confidence) sit alongside the
sources' own tags (`origin = 'board'`) in `job_tags`. When no source named
the employer, the one the model reads from the posting is linked.

Only public job-posting text is sent: title, employer, location, the board's
categories, and the first 1,500 characters of the description. Nothing about
the owner ever is. Requests set `store: false`, so Google does not keep them
for later conversation turns.

The model is `gemini-3.5-flash-lite`, checked against Google's docs on
2026-10-20: a stable model, free of charge on the free tier, and the one
Google suggests for high-volume simple data processing
([models](https://ai.google.dev/gemini-api/docs/models),
[pricing](https://ai.google.dev/gemini-api/docs/pricing)). Google no longer
lists free-tier limits in its docs; they are set per project and shown in
[AI Studio](https://aistudio.google.com), as requests per minute, tokens per
minute, and requests per day, which reset at midnight Pacific time
([rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)). Ten
requests a minute stays well under them. If Gemini answers 429 (limit
reached), the check stops tagging and the rest waits for the next run; a job
the model fails to tag is retried after 1, 2, 4, ... hours, at most a day.

### Vercel limits and chained runs

Vercel Hobby plan limits that the daily run must fit in, as documented on
2026-10-16:

- **Cron frequency:** at most once per day per cron job; a more frequent
  expression fails the deployment. Up to 100 cron jobs per project.
  ([Usage & Pricing for Cron Jobs](https://vercel.com/docs/cron-jobs/usage-and-pricing))
- **Timing:** precise only to the hour. `0 13 * * *` may run any time between
  13:00 and 13:59 UTC. ([same page](https://vercel.com/docs/cron-jobs/usage-and-pricing))
- **Maximum function duration:** 300 seconds (5 minutes), which is both the
  default and the maximum on Hobby, so a cron invocation gets at most 300 s.
  ([Vercel Functions Limits](https://vercel.com/docs/functions/limitations#max-duration);
  cron jobs share function limits per
  [Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs#cron-job-duration))
- **Delivery:** best effort. Vercel does not retry a failed invocation, can
  occasionally miss a run, and can occasionally deliver the same run twice, so
  the run must be idempotent and catch up on work since the last successful run.
  ([Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs#cron-job-delivery-and-idempotency))
- **Production only:** Vercel calls the production deployment URL with
  user agent `vercel-cron/1.0`. ([Cron Jobs](https://vercel.com/docs/cron-jobs#how-cron-jobs-work))
- **Monthly function allowance:** 4 active-CPU hours and 1,000,000 invocations;
  time spent waiting on I/O (for example, AI calls) does not count as active
  CPU. ([Vercel Hobby Plan](https://vercel.com/docs/plans/hobby))

**When the work outgrows one 300-second run** (a first run on an empty
database takes about seven minutes), the run chains to itself, combining the
cron job with requests to the app's own API as Vercel suggests for long work
([Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs#cron-job-duration)).
It stops starting new work after 270 seconds, then calls its own route with
`?chain=1` and the same `CRON_SECRET`. A chained call answers `202` at once
and works after responding (Next.js `after()`) with a fresh 300-second limit,
continuing where the last run stopped. A chain ends after 10 follow-up runs;
anything left waits for the next day.

## Login

Only one person can sign in: the owner, with the Google account named in
`ALLOWED_EMAIL`.

- **Google only.** The sign-in page has one button. Email and password and
  every other method are off.
- **Allowlist.** When Google sends back any other account, or an address
  Google has not verified, the sign-in is refused before anything is written:
  no user, account, or session row is created, and the sign-in page explains
  why. The address is checked again on every request, so changing
  `ALLOWED_EMAIL` locks out an existing session at once.
- **Protected by default.** [`apps/web/src/proxy.ts`](apps/web/src/proxy.ts)
  runs before every route. Without an allowed session, pages redirect to
  `/sign-in` and API routes answer `401`. Only `/sign-in`, Better Auth's own
  routes under `/api/auth/`, and `/api/cron/daily` (which checks
  `CRON_SECRET` itself) are public. Pages also check the session themselves.
- **Per-user data.** The `users` table's `id` (a UUID) is what every per-user
  table will reference: stars, read marks, pipeline stages, notes, and
  reminders. Adding a second person later means allowing another address, not
  changing tables.

### Why Better Auth

The login uses [Better Auth](https://www.better-auth.com) (`better-auth` 1.7)
rather than [Auth.js](https://authjs.dev) v5:

- Auth.js v5 (`next-auth@5`) is still a beta release, and since
  [September 2025](https://www.better-auth.com/blog/authjs-joins-better-auth)
  the Auth.js project is maintained by the Better Auth team, who recommend
  Better Auth for new projects. Better Auth has stable releases, supports
  Next.js 16, and is actively maintained.
- It has a first-party Drizzle adapter, so its tables are ordinary Drizzle
  tables in [`packages/db/src/schema.ts`](packages/db/src/schema.ts) with
  migrations generated like any other.
- Its database hooks can refuse a sign-in before the user row is written,
  which is exactly the allowlist rule.

Sessions are **database sessions**, Better Auth's default: the cookie holds a
signed random token, and the session lives in the `sessions` table, so signing
out deletes it for real. A signed copy of the session is also cached in a
cookie for 5 minutes, so most requests skip the database. Sessions last 30
days and are renewed while in use.

civic-lantern was the intended template, but it has no end-user sign-in (its web
app reaches its API with a server-only key), so this login is new work. The web
stack still matches civic-lantern's (Next.js 16 App Router, React 19,
`eslint-config-next`, Vitest).
