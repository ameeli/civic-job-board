# Deploying Civic Job Board

This guide takes you from nothing to a live site at `https://<something>.vercel.app`
that only your Google account can sign in to, plus a daily check that runs on its
own. Everything stays on free plans (0 USD/month): Neon Free, Vercel Hobby, and a
free Google Cloud project.

Plan on about 45 minutes. Console wording below was checked against each
provider's official docs on 2026-10-20; consoles change, so if a label differs
slightly, look for the closest match and use the linked docs.

The steps run in this order because each one needs something from the one
before it:

1. [Create the Neon database](#step-1-create-the-neon-project) and copy its connection strings.
2. [Create the tables](#step-2-create-the-tables) by running the migrations against it.
3. [Create the Vercel project](#step-3-create-the-vercel-project), which gives you the site's address.
4. [Create the Google sign-in client](#step-4-create-the-google-oauth-client), which needs that address.
5. [Set the environment variables in Vercel](#step-5-set-the-environment-variables-in-vercel) and redeploy.
6. [Check that sign-in and the daily check work](#step-6-verify-the-live-site).

## Before you start

You need:

- **Your everyday Gmail account.** It is the only account that will be able to
  sign in, and you can use it for the Google Cloud console too.
- **A GitHub account** with access to this repository.
- **A computer with the repository checked out**, Node.js 24 and pnpm, for
  step 2. From the repository root:

  ```sh
  corepack enable   # installs the pnpm version the repository pins
  pnpm install
  ```

- **A private note** (a password manager entry works well) to collect the
  values below as you go. Several are secrets: never commit them, paste them
  into an issue or pull request, or share a screenshot of them. This
  repository is public.

| Value | Where it comes from | Secret? |
| --- | --- | --- |
| Pooled connection string | Step 1 | Yes |
| Direct connection string | Step 1 | Yes |
| Site address (`https://….vercel.app`) | Step 3 | No |
| Google client ID | Step 4 | No, but keep it private anyway |
| Google client secret | Step 4 | Yes |
| `BETTER_AUTH_SECRET` | Step 5 (you generate it) | Yes |
| `CRON_SECRET` | Step 5 (you generate it) | Yes |
| Gemini API key | Step 5 | Yes |

## Step 1: Create the Neon project

Neon hosts the Postgres database.

1. Go to the [Neon Console](https://console.neon.tech) and sign up or sign in.
2. Click **New Project**.
3. Fill in the form
   ([Neon: Create a project](https://neon.com/docs/manage/projects#create-a-project)):
   - **Project name:** `civic-job-board`.
   - **Region:** the AWS region in **US East (N. Virginia)**. Vercel runs the app's server
     code in Washington, D.C. (`iad1`) by default, so a nearby database keeps
     every page fast.
   - **Services:** leave **Postgres database** on and its default version.
     Leave the other services (such as **Neon Auth**) off; the app has its own
     sign-in.
4. Click **Create project**.

> **Use a new project, not civic-lantern's.** On the Free plan the main limits
> are per project: 100 compute hours a month and 1 GB of storage (with 20 GB
> across the account and up to 100 projects)
> ([Neon plans](https://neon.com/docs/introduction/plans)). A separate project
> gives this app its own allowance, so neither app can use up the other's. The
> database also pauses after 5 minutes without use, so the first page load after
> a quiet spell takes a moment longer.

Now copy two connection strings
([Neon: Connect from any application](https://neon.com/docs/connect/connect-from-any-app)):

1. Click **Connect** in the console. The **Connect to your branch** modal opens
   with the `production` branch and the `neondb` database already selected.
2. With **Connection pooling** turned on (the default), copy the connection
   string. Its host name contains `-pooler`. Save it as the **pooled connection
   string**; the app uses it.
3. Turn **Connection pooling** off and copy the string again. Save it as the
   **direct connection string**; you only use it for migrations in step 2.

Both look like
`postgresql://neondb_owner:…@ep-….us-east-1.aws.neon.tech/neondb?sslmode=require…`.

## Step 2: Create the tables

The tables are defined by the SQL files in `packages/db/migrations/`. From the
repository root on your computer, run (keep the single quotes; the string
contains characters the shell would otherwise misread):

```sh
DATABASE_URL='<direct connection string>' pnpm db:migrate
```

It ends with `migrations applied successfully!`. In the Neon Console, open
**Tables** to inspect the tables defined in
[`packages/db/src/schema.ts`](../packages/db/src/schema.ts).

Running it again is safe: migrations that already ran are skipped. Run it again
whenever a future change adds a migration, before that change is deployed. The
direct connection is used here because Neon's pooled connections are meant for
the app's many short queries, not for schema changes
([Neon: Connection pooling](https://neon.com/docs/connect/connection-pooling)).

## Step 3: Create the Vercel project

Vercel builds and hosts the app and runs the daily check.

1. Go to [vercel.com](https://vercel.com) and sign up or sign in. Choose the
   free **Hobby** plan, and sign in with GitHub so Vercel can see the
   repository.
2. Open [New Project](https://vercel.com/new). If `civic-job-board` is not in
   the list, follow the prompt to install or adjust the Vercel GitHub app and
   give it access to this repository.
3. Click **Import** next to `civic-job-board`.
4. On the configuration page
   ([Vercel: Deploying a Git repository](https://vercel.com/docs/git#deploying-a-git-repository)):
   - **Project Name:** `civic-job-board`. The site address is based on it.
   - **Root Directory:** click **Edit**, choose `apps/web`, and confirm. This
     matters: the app lives in that folder. Vercel still installs the whole
     pnpm workspace from the repository root
     ([Vercel: Root Directory](https://vercel.com/docs/builds/configure-a-build#root-directory)).
   - **Framework Preset:** should say **Next.js**. Leave the build settings and
     environment variables alone for now.
5. Click **Deploy**. The build should succeed. Opening the site now shows an
   error page because its settings are not filled in yet; that is expected.
6. Find the site address: on the project's overview page, look under
   **Domains**. It is usually `civic-job-board.vercel.app`, or a variant if that
   name was taken. Save it with `https://` in front and no slash at the end,
   for example `https://civic-job-board.vercel.app`.

From now on, every push to `main` deploys the site, and every pull request gets
its own preview deployment.

## Step 4: Create the Google OAuth client

This lets the app send you to Google to sign in. Use your everyday Gmail
account for these steps.

### Create a Google Cloud project

1. Open the [Google Cloud console](https://console.cloud.google.com) and accept
   the terms if asked.
2. Click the project picker at the top of the page, then **New project**. Name
   it `civic-job-board` and click **Create**. When it is ready, make sure it is
   the selected project.

### Set up the Google Auth Platform

([Google: Configure the Google Auth Platform](https://support.google.com/cloud/answer/15544987))

1. Open the [Google Auth Platform overview](https://console.cloud.google.com/auth/overview)
   and click **Get started**.
2. **App Information:** **App name** `Civic Job Board`; **User support email**
   your Gmail address.
3. **Audience:** choose **External** (Internal is only for Google Workspace
   organizations).
4. **Contact Information:** your Gmail address.
5. **Finish:** agree to the Google API Services User Data Policy, then click
   **Create**.

Leave the publishing status as **Testing**; there is no need to publish or
verify the app. The app asks Google only for your name, email address, and
profile picture, and for apps that ask only for those, Google lets people sign
in without being on the test user list, without a warning screen, and without
the 7-day expiry that testing apps otherwise have
([Google: Audience](https://support.google.com/cloud/answer/15549945)). Do not
add other scopes under **Data Access**. Google still lets any account reach the
app's callback; the app itself turns away every account except
`ALLOWED_EMAIL`.

Optional safeguard: open [Audience](https://console.cloud.google.com/auth/audience),
click **Add users** under **Test users**, and add your Gmail address. Your
sign-in then works even if Google ever starts asking for the test user list.

### Create the client

([Google: Manage OAuth clients](https://support.google.com/cloud/answer/15549257))

1. Open [Clients](https://console.cloud.google.com/auth/clients) and click
   **Create client**.
2. **Application type:** **Web application**. **Name:** `Civic Job Board`.
3. **Authorized JavaScript origins:** leave empty. Sign-in runs on the server.
4. **Authorized redirect URIs:** click **Add URI** and enter each of these
   (replace the second with your site address from step 3):

   ```
   http://localhost:3000/api/auth/callback/google
   https://civic-job-board.vercel.app/api/auth/callback/google
   ```

   They must match exactly: `https` for the live site (`http` is allowed only
   for `localhost`), and no slash at the end
   ([Google: redirect URI rules](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation)).
5. Click **Create**.
6. **Copy the Client ID and the Client secret now.** Google shows the full
   secret only once. If you lose it, open the client and use **Add secret** to
   make a new one.

Changes to a client can take a few minutes to take effect at Google.

## Step 5: Set the environment variables in Vercel

First, generate the two random secrets on your computer. Each command prints a
new value; save each in your private note:

```sh
openssl rand -base64 32   # BETTER_AUTH_SECRET
openssl rand -hex 32      # CRON_SECRET
```

### Create the Gemini API key

The daily check uses Google's Gemini free tier; see the
[README's AI tags section](../README.md#ai-tags) for tagging and queue behavior.

([Google: Using Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key))

1. Open [Google AI Studio](https://aistudio.google.com) and sign in with your
   everyday Gmail account. Accept the terms if asked. For a new user, AI Studio
   creates a default Google Cloud project and a first API key.
2. Open **Dashboard** in the left panel, then **API Keys**. Copy the key that
   is there, or click **Create API key**, choose the project, and copy the new
   one. Save it in your private note: it is a secret.
3. **Do not set up billing** for that project. A project without a billing
   account stays on the free tier, which is what keeps this at 0 USD/month;
   linking billing moves it to a paid tier
   ([Google: Rate limits, usage tiers](https://ai.google.dev/gemini-api/docs/rate-limits#usage-tiers)).

Check your project's limits in AI Studio, then configure the optional
[Gemini environment variables](../README.md#environment-variables) if needed.

### Add the variables

In Vercel, open the project, select **Settings**, then
**Environment Variables**
([Vercel: Managing environment variables](https://vercel.com/docs/environment-variables/managing-environment-variables)).
Add each variable below. For each one, enter the **Name** and **Value**, select
only the **Production** environment, and click **Save**.

| Name | Value |
| --- | --- |
| `DATABASE_URL` | The **pooled** connection string from step 1. |
| `ALLOWED_EMAIL` | Your everyday Gmail address. Case does not matter. If it is empty, nobody can sign in. |
| `BETTER_AUTH_SECRET` | The value you generated above. It signs the sign-in cookies. |
| `BETTER_AUTH_URL` | Your site address from step 3, for example `https://civic-job-board.vercel.app`, with no slash at the end. |
| `GOOGLE_CLIENT_ID` | The client ID from step 4. |
| `GOOGLE_CLIENT_SECRET` | The client secret from step 4. |
| `CRON_SECRET` | The value you generated above. Vercel sends it with every daily check, and the check refuses to run without it ([Vercel: Securing cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)). |
| `GEMINI_API_KEY` | The Gemini API key from [Create the Gemini API key](#create-the-gemini-api-key). |

Why only **Production**: Google accepts sign-ins only from the exact addresses
in step 4, and each preview deployment gets its own changing address, so sign-in
cannot work on previews anyway. Keeping the secrets and the database out of
previews means a pull request can never touch your real data. Preview
deployments still build; opening one shows an error page.

Settings apply only to new deployments, so redeploy now: open **Deployments**,
click the **⋯** menu on the most recent deployment, choose **Redeploy**, and
confirm.

## Step 6: Verify the live site

### Sign-in

1. Open your site address in a private browser window. You should land on the
   **Civic Job Board** sign-in page.
2. Click **Sign in with Google** and choose your everyday Gmail account. You
   should come back to the home page showing **Signed in as** your address.
3. Click **Sign out**. You should be back on the sign-in page.
4. Optional: sign in with a different Google account. The sign-in page should
   say **That Google account is not allowed to sign in.**, and nothing about
   that account is stored.
5. In the Neon Console, the `users` table should have exactly one row: yours.

If something goes wrong:

| What you see | What to check |
| --- | --- |
| Google says `Error 400: redirect_uri_mismatch` | The redirect URI in step 4 matches `BETTER_AUTH_URL` + `/api/auth/callback/google` exactly. |
| Google says "Access blocked" or that the app "has not completed the Google verification process" | Add your Gmail address under **Audience** > **Test users** in the Google Auth Platform (the optional safeguard in step 4), then try again. |
| "That Google account is not allowed to sign in." for your own account | The spelling of `ALLOWED_EMAIL`. Redeploy after changing it. |
| An error page instead of the sign-in page | Every variable in step 5 is set for Production, and you redeployed afterwards. The project's **Logs** page shows the error. |
| "Sign-in did not finish." | Try again in a fresh private window; if it repeats, check **Logs**. |

### The daily check

See the [README](../README.md#the-daily-check) for daily-check behavior and
[its timing and continuation limits](../README.md#vercel-limits-and-chained-runs).

1. In Vercel, open **Settings**, then **Cron Jobs**. The `/api/cron/daily` job
   should be listed with the schedule in
   [`apps/web/vercel.json`](../apps/web/vercel.json)
   ([Vercel: Managing cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)).
2. Run it once yourself from a terminal. `read -rs` keeps the secret out of
   your shell history; paste `CRON_SECRET` when it waits, then press Enter:

   ```sh
   read -rs CRON_SECRET
   curl -i -H "Authorization: Bearer $CRON_SECRET" https://civic-job-board.vercel.app/api/cron/daily
   ```

   Expect `HTTP/2 200` with a summary. `"moreWork":true` means work remains;
   check Vercel's logs to confirm follow-up runs started and completed.
   A `"status":"busy"` summary means another check already holds the lease.
   The same request without the header returns `401`.
3. In the Neon Console, after the checks finish, the `source_runs` table has
   rows for the configured [sources](../packages/core/src/sources/index.ts), each with
   `ok = true` and a `seen` count above 0. A row with `partial = true` was cut
   short by the time limit; look for a later completed row for that source.
   The `jobs` table holds the jobs; with `GEMINI_API_KEY` set, their
   `summary` fills in as the AI step works through `ai_queue`.
4. The next day, check `source_runs` again for new rows during the
   [scheduled window](../README.md#vercel-limits-and-chained-runs), or use
   **View Logs** next to the job in **Cron Jobs**.

## Running the app on your computer

The `http://localhost:3000` redirect URI from step 4 lets you sign in locally
too. Copy `.env.example` to `apps/web/.env.local`, fill in the same values
(with `BETTER_AUTH_URL=http://localhost:3000`, and a local or separate Neon
database for `DATABASE_URL`), and run `pnpm dev`. See the
[README](../README.md#local-setup).
