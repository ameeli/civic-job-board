import { CTFG_SOURCE } from "@civic-job-board/core/civic-tech-field-guide";
import { describeJobTags } from "@civic-job-board/core/job-tags";
import { readJobs, readSourceProblems } from "@civic-job-board/db";
import { getDb } from "@/lib/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAllowedSession } from "@/lib/auth";
import { JOB_SOURCES } from "@/lib/daily-check";
import { signOut } from "./actions";

export default async function HomePage() {
  // The proxy already requires a session; this keeps the page safe on its own.
  const session = await getAllowedSession(await headers());
  if (!session) {
    redirect("/sign-in");
  }

  const db = getDb();
  const [jobs, sourceProblems] = await Promise.all([readJobs(db), readSourceProblems(db, JOB_SOURCES, new Date())]);

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
      <main className="home">
        {(sourceProblems.failed.length > 0 || sourceProblems.stale.length > 0) && (
          <div className="alert" role="status">
            {sourceProblems.failed.length > 0 && (
              <div>Last daily check failed or found nothing for: {sourceProblems.failed.join(", ")}</div>
            )}
            {sourceProblems.stale.map(({ source, lastStartedAt }) => (
              <div key={source}>{source}: not checked since {formatCheckDate(lastStartedAt)}</div>
            ))}
          </div>
        )}
        <h2>Saved jobs</h2>
        {jobs.length ? (
          <ul>
            {jobs.map((job) => (
              <li key={job.id}>
                <a href={job.applyUrl || job.sourceUrl}>{job.title}</a>
                <p>{job.employerName} · {job.sources.join(", ")}</p>
                {job.roleTags && job.sectorTags && job.seniority && (
                  <p>{describeJobTags({ roleTags: job.roleTags, sectorTags: job.sectorTags, seniority: job.seniority })}</p>
                )}
                {job.summary && <p>{job.summary}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p>No jobs saved yet - run the daily check</p>
        )}
        {jobs.some((job) => job.sources.includes(CTFG_SOURCE)) && (
          <p>
            Jobs from the <a href="https://civictech.guide">Civic Tech Field Guide</a> are shared under{" "}
            <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.
          </p>
        )}
      </main>
    </>
  );
}

/** "Nov 21": the day a source was last checked, in UTC like the daily cron. */
function formatCheckDate(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
