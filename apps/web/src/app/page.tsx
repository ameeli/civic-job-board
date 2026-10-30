import { readJobs } from "@civic-job-board/db";
import { getDb } from "@/lib/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAllowedSession } from "@/lib/auth";
import { signOut } from "./actions";

export default async function HomePage() {
  // The proxy already requires a session; this keeps the page safe on its own.
  const session = await getAllowedSession(await headers());
  if (!session) {
    redirect("/sign-in");
  }

  const jobs = await readJobs(getDb());

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
        <h2>Saved jobs</h2>
        {jobs.length ? (
          <ul>
            {jobs.map((job) => (
              <li key={job.id}>
                <a href={job.applyUrl || job.sourceUrl}>{job.title}</a>
                <p>{job.employerName} · {job.source}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p>No jobs saved yet - run the daily check</p>
        )}
      </main>
    </>
  );
}
