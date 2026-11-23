import { jobTagLabels } from "@civic-job-board/core/job-tags";
import type { readJob } from "@civic-job-board/db";
import Link from "next/link";

type Job = NonNullable<Awaited<ReturnType<typeof readJob>>>;

const postedDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

/** The job detail sheet over the home page; null `job` shows a not-found state. */
export function JobDetailSheet({ job }: { job: Job | null }) {
  return (
    <>
      {/* The scrim is a mouse convenience; the Close link is the accessible way out. */}
      <Link href="/" scroll={false} className="sheet-scrim" aria-hidden tabIndex={-1} />
      <aside className="sheet" aria-labelledby="sheet-title">
        <div className="sheet-bar">
          <Link href="/" scroll={false} className="button button-quiet">
            Close
          </Link>
        </div>
        <div className="sheet-body">{job ? <JobDetail job={job} /> : <JobNotFound />}</div>
      </aside>
    </>
  );
}

function JobNotFound() {
  return (
    <div className="sheet-head">
      <h2 id="sheet-title">Job not found</h2>
      <p className="sheet-muted">It may have been merged into another job, or the link is wrong.</p>
    </div>
  );
}

function JobDetail({ job }: { job: Job }) {
  const applyUrl = job.applyUrl || job.listings[0]?.sourceUrl;
  const tags = job.roleTags && job.sectorTags && job.seniority
    ? jobTagLabels({ roleTags: job.roleTags, sectorTags: job.sectorTags, seniority: job.seniority })
    : null;

  return (
    <>
      <header className="sheet-head">
        {job.employerName && <p className="sheet-employer">{job.employerName}</p>}
        <h2 id="sheet-title">{job.title}</h2>
        {(job.location || job.salary) && (
          <p className="sheet-muted">{[job.location, job.salary].filter(Boolean).join(" · ")}</p>
        )}
        {applyUrl && (
          <a href={applyUrl} target="_blank" rel="noreferrer" className="button button-primary sheet-apply">
            Apply
          </a>
        )}
      </header>
      {/* Role is the only tab so far; it becomes a real tab list when a second tab arrives. */}
      <div className="sheet-tabs">
        <h3 className="sheet-tab">Role</h3>
      </div>
      <section className="sheet-panel">
        {job.summary && <p className="sheet-summary">{job.summary}</p>}
        <dl className="sheet-facts">
          {tags && (
            <>
              <dt>Roles</dt>
              <dd>{tags.roles.join(", ")}</dd>
              <dt>Sectors</dt>
              <dd>{tags.sectors.join(", ")}</dd>
              <dt>Seniority</dt>
              <dd>{tags.seniority}</dd>
            </>
          )}
          <dt>Sources</dt>
          <dd>
            {job.listings.map((listing, index) => (
              <span key={listing.source}>
                {index > 0 && ", "}
                <a href={listing.sourceUrl} target="_blank" rel="noreferrer">{listing.source}</a>
              </span>
            ))}
          </dd>
          {job.postedAt && (
            <>
              <dt>Posted</dt>
              <dd>{postedDate.format(job.postedAt)}</dd>
            </>
          )}
        </dl>
        {job.description && (
          <details className="sheet-description">
            <summary>Full description</summary>
            {/* Stored descriptions are plain text; React escapes it and CSS keeps its line breaks. */}
            <p>{job.description}</p>
          </details>
        )}
      </section>
    </>
  );
}
