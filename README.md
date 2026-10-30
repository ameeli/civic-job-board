# civic-job-board

Unified inbox-style job board for civic tech and tech-for-good roles.

A personal, single-user app that checks civic job boards and newsletters once a
day and merges the jobs it finds into one email-style inbox.

This repository is currently a **skeleton**: it deploys, has Google sign-in
locked to the owner's account, saves Tech Jobs for Gov listings on a daily
check, tags each new job once with Gemini, and has CI. After sign-in, the home
page shows a read-only list of saved jobs with their title, employer, and
source, ordered by posted date, newest first, with undated jobs last; tagged
jobs also show their role, sector, and seniority tags and a one-line summary.
Titles link to the application link when present, otherwise to the source
listing. With no saved jobs, it prompts you to run the daily check. Other
sources and the full inbox UI are not built yet; screens and visual design are
being prototyped separately.

To put it online, follow [`docs/deploy.md`](docs/deploy.md).

## Stack and why

Hosting must cost **0 USD/month**, so every piece fits a free tier:

| Piece | Choice | Why |
| --- | --- | --- |
| Web app, server functions, daily check | [Vercel](https://vercel.com) Hobby plan, Next.js App Router | Free; one platform runs the UI, the API routes, and the built-in [cron](https://vercel.com/docs/cron-jobs). |
| Database | [Neon](https://neon.com) Free Postgres | Free serverless Postgres that pairs with Vercel. |
| Sign-in | [Better Auth](https://www.better-auth.com) with Google | Free library; sessions live in the app's own Neon database. See [Login](#login). |
| AI | Google Gemini free tier | Free; tags jobs with `gemini-3.1-flash-lite`. Free Google Search grounding (later) is only available on Gemini 2.5 Flash / Flash-Lite. |
| Email-only newsletters (later) | A dedicated Gmail account + Google Apps Script | Free; the script forwards new mail to the app. See [`apps-script/`](apps-script/README.md). |

Supabase, Cloudflare, Render, and GitHub Actions scheduling are deliberately not
used. GitHub Actions only runs CI.

### Repository layout

```
apps/web/        Next.js app deployed to Vercel (sign-in, saved-jobs list, daily cron route)
packages/core/   Source adapter, pure job mapping, job tag lists, and shared auth checks
packages/db/     Drizzle schema, SQL migrations, and database helpers
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

To try the daily check locally (Vercel does not run crons in local dev), set
`CRON_SECRET`, run the app, and call the route yourself:

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
| `GEMINI_API_KEY` | Daily check | Google Gemini API key (free tier) for tagging jobs. When it is unset, tagging is skipped and recorded while fetching still works. |

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
`GET /api/cron/daily` once a day (`0 12 * * *`, in UTC). The route checks the
`CRON_SECRET` bearer header and calls `dailyCheck` to fetch Tech Jobs for Gov's
WordPress API (all pages). It saves listings in `jobs`, updating by source and
source job id without deleting older jobs. Employer, location, and salary are
kept as supplied by the API; salary is not parsed or converted. Posted dates
use the API's UTC timestamp and deadlines retain the board's date text.

An apply link comes from `meta._application`, with HTML entities decoded, or is
null when absent. A fetch, mapping, or save failure ends the source check and
records the error, while earlier saves remain. After the check, the app
writes one `source_runs` row with success/failure, jobs seen, new jobs, and any
error. Empty results record success with zero seen, so the inbox banner can
flag them later. The local curl command above runs this same function. Other
sources come in later slices.

A completed run answers HTTP 200 with each part's result, and top-level `ok` is
true only when every part succeeded. `runId` is the source check's
`source_runs` row; `error` appears only on a failed part:

```json
{"ok":false,"runId":4,"fetch":{"ok":true,"seen":319,"new":0},"tagging":{"ok":false,"tagged":0,"defaulted":0,"transient":27,"error":"Gemini: HTTP 503"}}
```

`tagging.defaulted` counts tagged jobs whose answer defaulted to unknown, and
`tagging.transient` counts jobs left untagged for the next run after a failed
request. Only a run that throws (for example, the database is unreachable)
answers HTTP 500.

### Job tags

After the source check, the daily check sends untagged jobs to Gemini
(`gemini-3.1-flash-lite`, free tier), one job per request, oldest posted first.
Each request sends the title, employer, and the first 4,000 characters of the
description, and stores 1-3 role tags, 1-3 sector tags, one seniority, and a
one-sentence summary on the job, with `tagged_at` set. The fixed tag lists live
in [`packages/core/src/job-tags.ts`](packages/core/src/job-tags.ts); Gemini's
structured output schema enumerates them, and `unknown` is allowed in each.

Each job's tags are saved once. A completed answer can tag the job even when
unusable: off-list tags are dropped, a field with nothing valid left becomes
`unknown`, and an empty summary is stored as null. Only a failed request
(network error, timeout, or HTTP error such as 429 or 5xx), including a failure
while reading the response body, leaves the job untagged for the next run.
An HTTP 429 (rate limited) or 503 (overloaded) retries the same job up to
twice, waiting 30 then 60 seconds. A wait that would run past the run's time
budget is not started. If recovery ends in any request failure, tagging stops for the rest of the
run: that job and every remaining selected job stay untagged for the next run.
Completed malformed answers default to unknown. Overlapping runs may send
duplicate requests, but saves only apply while `tagged_at` is null, so the
first save wins and completed tags cannot be overwritten.

The free tier allows 10 requests per minute and 500 per day (as of
2026-10-30), so requests are 6.5 seconds apart, at most 35 jobs are tagged per
run, and no request starts later than 260 seconds into the run, so it ends
inside the 300-second limit. A backlog clears over several days. Each run writes
a `source_runs` row with source `gemini-tagging`: `seen` is jobs sent, plus
jobs left unsent after a 429 or 503 stop, `new` is
jobs tagged, `defaulted_to_unknown` is tagged jobs whose answer lacked a valid
role, sector, or seniority, and `error` is the first failed request. A save
skipped because another run already tagged the job counts toward neither
`new` nor `defaulted_to_unknown`. Without
`GEMINI_API_KEY`, the row records that tagging was skipped.

### Progress logs

The daily check prints one line per step to the console, which Vercel keeps in
the project's **Logs** (and `pnpm dev` prints in the terminal). Each line starts
with `[daily-check]`, then an event name and `key=value` fields:

```
[daily-check] run-start
[daily-check] source-start source=tech-jobs-for-gov
[daily-check] source-done source=tech-jobs-for-gov ok=true fetched=319 saved=319 new=2 duration_ms=1653
[daily-check] tagging-start selected=31 cap=35
[daily-check] tagging-job n=1/31 job_id=<uuid> outcome=tagged attempts=1 duration_ms=1840
[daily-check] tagging-retry job_id=<uuid> attempt=2 status=503 wait_s=30
[daily-check] tagging-retry job_id=<uuid> attempt=3 status=503 wait_s=60
[daily-check] tagging-job n=2/31 job_id=<uuid> outcome=transient-error status=503 error="Gemini: HTTP 503" attempts=3 duration_ms=91340
[daily-check] tagging-stopped reason=overloaded status=503 untagged=29
[daily-check] run-done fetched=319 new=2 tagged=1 defaulted_to_unknown=0 transient_failures=30 duration_ms=101020
```

A job's `outcome` is `tagged`, `defaulted-to-unknown`, `transient-error`, or
`already-tagged` (an overlapping run saved it first). Each retry wait logs a
`tagging-retry` line, and `tagging-retry-skipped` notes a wait that would have
run past the time budget. `tagging-stopped` gives
`reason=rate-limited`, `overloaded`, or `time-budget`; `tagging-skipped
reason=missing-api-key` replaces the tagging lines when `GEMINI_API_KEY` is
unset. Logs never include secrets, API keys, request headers, or job
descriptions.

Vercel Hobby plan limits that the daily run must fit in, as documented on
2026-10-16:

- **Cron frequency:** at most once per day per cron job; a more frequent
  expression fails the deployment. Up to 100 cron jobs per project.
  ([Usage & Pricing for Cron Jobs](https://vercel.com/docs/cron-jobs/usage-and-pricing))
- **Timing:** precise only to the hour. `0 12 * * *` may run any time between
  12:00 and 12:59 UTC. ([same page](https://vercel.com/docs/cron-jobs/usage-and-pricing))
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

**If the work outgrows one 300-second run:** Vercel's documented approach is to
split it into separate units or to combine the cron job with regular HTTP
requests to the app's own API
([Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs#cron-job-duration)).
So a run can chain to itself: before its time runs out, it makes an
authenticated HTTP request to its own route to continue where it stopped, and
each request gets a fresh 300-second limit. Alternatively, sources can be spread
over several staggered daily cron jobs (up to 100 per project).

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
