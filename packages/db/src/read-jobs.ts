import { eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { jobListings, jobs } from "./schema";

/** Every job, newest posted first, with the sources that list it. */
export function readJobs(db: Db) {
  return db.select({
    id: jobs.id, title: jobs.title, employerName: jobs.employerName, applyUrl: jobs.applyUrl,
    roleTags: jobs.roleTags, sectorTags: jobs.sectorTags, seniority: jobs.seniority, summary: jobs.summary,
    sources: sql<string[]>`array_agg(distinct ${jobListings.source} order by ${jobListings.source})`,
    // Only a job with no apply link links to its listing, and such a job has one listing.
    sourceUrl: sql<string>`min(${jobListings.sourceUrl})`,
  }).from(jobs).innerJoin(jobListings, eq(jobListings.jobId, jobs.id)).groupBy(jobs.id)
    .orderBy(sql`${jobs.postedAt} desc nulls last`, jobs.id);
}
