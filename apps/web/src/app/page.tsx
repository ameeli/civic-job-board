import { CTFG_SOURCE } from "@civic-job-board/core/civic-tech-field-guide";
import { readJob, readJobs, readSourceProblems } from "@civic-job-board/db";
import { getDb } from "@/lib/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAllowedSession } from "@/lib/auth";
import { JOB_SOURCES } from "@/lib/daily-check";
import { sourceName } from "@/lib/job-display";
import { signOut } from "./actions";
import { JobCard } from "./job-card";
import { TodayHeading } from "./today-heading";
import { JobDetailSheet } from "./job-detail-sheet";

/** The saved jobs; `?job=<id>` also opens that job's detail sheet. */
export default async function HomePage({ searchParams }: PageProps<"/">) {
  // The proxy already requires a session; this keeps the page safe on its own.
  const session = await getAllowedSession(await headers());
  if (!session) {
    redirect("/sign-in");
  }

  const { job: openJobId } = await searchParams;
  const db = getDb();
  const [jobs, openJob, sourceProblems] = await Promise.all([
    readJobs(db),
    typeof openJobId === "string" ? readJob(db, openJobId) : undefined,
    readSourceProblems(db, JOB_SOURCES, new Date()),
  ]);

  return (
    <>
      <header className="site-header">
        <h1 className="site-title">Civic Job Board</h1>
        <div className="account">
          <span className="account-email">
            Signed in as {session.user.email}
          </span>
          <form action={signOut}>
            <button type="submit" className="button button-quiet">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="inbox">
        <div className="inbox-header">
          <TodayHeading />
          <p className="inbox-count">{jobs.length} {jobs.length === 1 ? "job" : "jobs"}</p>
        </div>
        {(sourceProblems.failed.length > 0 || sourceProblems.stale.length > 0) && (
          <div className="source-banner" role="status">
            {sourceProblems.failed.length > 0 && (
              <div>Last daily check failed or found nothing for: {sourceProblems.failed.map(sourceName).join(", ")}</div>
            )}
            {sourceProblems.stale.map(({ source, lastStartedAt }) => (
              <div key={source}>{sourceName(source)}: not checked since <span className="nowrap">{formatCheckDate(lastStartedAt)}</span></div>
            ))}
          </div>
        )}
        {jobs.length ? (
          <div className="job-cards">
            {jobs.map(job => <JobCard key={job.id} job={job} />)}
          </div>
        ) : (
          <p className="inbox-empty">No jobs saved yet - run the daily check</p>
        )}
        {jobs.some((job) => job.sources.includes(CTFG_SOURCE)) && (
          <p className="inbox-credit">
            Jobs from the <a href="https://civictech.guide">Civic Tech Field Guide</a> are shared under{" "}
            <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.
          </p>
        )}
      </main>
      {openJob !== undefined && <JobDetailSheet job={openJob} />}
    </>
  );
}

/** "Nov 21": the day a source was last checked, in UTC like the daily cron. */
function formatCheckDate(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
