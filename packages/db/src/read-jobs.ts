import { eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { jobListings, jobs } from "./schema";

/** Every job, newest posted first, with the sources that list it. */
export function readJobs(db: Db) {
  return db.select({
    id: jobs.id, title: jobs.title, employerName: jobs.employerName, location: jobs.location,
    applyUrl: jobs.applyUrl, postedAt: jobs.postedAt,
    roleTags: jobs.roleTags, sectorTags: jobs.sectorTags, seniority: jobs.seniority, summary: jobs.summary,
    sources: sql<string[]>`array_agg(distinct ${jobListings.source} order by ${jobListings.source})`,
    sourceUrl: sql<string>`min(${jobListings.sourceUrl})`,
  }).from(jobs).innerJoin(jobListings, eq(jobListings.jobId, jobs.id)).groupBy(jobs.id)
    .orderBy(sql`${jobs.postedAt} desc nulls last`, jobs.id);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One job with every listing of it, or null when no job has that id (including ids that are not UUIDs). */
export async function readJob(db: Db, id: string) {
  if (!UUID.test(id)) return null;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  if (!job) return null;
  const listings = await db.select({ source: jobListings.source, sourceUrl: jobListings.sourceUrl })
    .from(jobListings).where(eq(jobListings.jobId, id)).orderBy(jobListings.source);
  return { ...job, listings };
}
