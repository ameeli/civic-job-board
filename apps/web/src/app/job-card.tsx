import { jobTagLabels } from "@civic-job-board/core/job-tags";
import Link from "next/link";
import type { readJobs } from "@civic-job-board/db";
import { employerInitials, formatPostedDate, sourceName } from "@/lib/job-display";

type Job = Awaited<ReturnType<typeof readJobs>>[number];

/** One job in the inbox feed; the whole card opens the job detail sheet. */
export function JobCard({ job }: { job: Job }) {
  const tags = job.roleTags && job.sectorTags && job.seniority
    ? jobTagLabels({ roleTags: job.roleTags, sectorTags: job.sectorTags, seniority: job.seniority })
    : null;
  const [firstSource, ...otherSources] = job.sources.map(sourceName);
  const details = [job.location, tags?.seniority].filter(Boolean);

  return (
    <article className="job-card">
      <div className="job-card-top">
        <span className="employer-badge" aria-hidden="true">
          {job.employerName ? employerInitials(job.employerName) : "?"}
        </span>
        {job.employerName
          ? <span className="job-card-employer">{job.employerName}</span>
          : <span className="job-card-employer job-card-employer-missing">Employer not listed</span>}
        {job.postedAt && (
          <time className="job-card-posted" dateTime={job.postedAt.toISOString()}>
            {formatPostedDate(job.postedAt)}
          </time>
        )}
      </div>
      <h3 className="job-card-title">
        <Link id={`job-${job.id}`} href={`/?job=${job.id}`} scroll={false}>{job.title}</Link>
      </h3>
      {details.length > 0 && (
        <p className="job-card-details">
          {details.map(detail => <span key={detail}>{detail}</span>)}
        </p>
      )}
      {job.summary && <p className="job-card-summary">{job.summary}</p>}
      {tags && tags.roles.length + tags.sectors.length > 0 && (
        <ul className="job-card-tags" aria-label="Tags">
          {tags.roles.map(role => <li key={role} className="chip chip-role">{role}</li>)}
          {tags.sectors.map(sector => <li key={sector} className="chip chip-sector">{sector}</li>)}
        </ul>
      )}
      <p className="job-card-sources">
        <span className="job-card-sources-label">via</span> {firstSource}
        {otherSources.length > 0 && (
          <>
            {" "}<span className="job-card-sources-label">· also on</span>
            {otherSources.map(source => <span key={source} className="chip chip-source">{source}</span>)}
          </>
        )}
      </p>
    </article>
  );
}
