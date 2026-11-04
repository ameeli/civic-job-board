import { and, eq, sql } from "drizzle-orm";
import { chooseListingJob } from "./choose-listing-job";
import type { Db } from "./client";
import { jobListings, jobs } from "./schema";

type NewJob = typeof jobs.$inferInsert;

/** One board's post of a job, as a source's mapper returns it. */
export type JobListing =
  Omit<NewJob, "id" | "roleTags" | "sectorTags" | "seniority" | "summary" | "taggedAt">
  & Omit<typeof jobListings.$inferInsert, "jobId">;

/**
 * Saves a listing into its job (see chooseListingJob) and returns whether that
 * created a new job. Saves run one at a time, so overlapping checks can neither
 * race to create the same job nor count it as new twice.
 */
export async function saveListing(db: Db, listing: JobListing): Promise<boolean> {
  const { source, sourceJobId, sourceUrl, ...job } = listing;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('save-listing'))`);
    const [listed] = await tx.select({ jobId: jobListings.jobId }).from(jobListings)
      .where(and(eq(jobListings.source, source), eq(jobListings.sourceJobId, sourceJobId)));
    const [matching] = job.applyUrl == null ? [] : await tx.select({ id: jobs.id }).from(jobs)
      .where(and(eq(jobs.applyUrl, job.applyUrl), eq(jobs.title, job.title)));
    const listedJob = listed ? {
      id: listed.jobId, shared: await tx.$count(jobListings, eq(jobListings.jobId, listed.jobId)) > 1,
    } : null;
    const { saveInto, deleteJob } = chooseListingJob(matching?.id ?? null, listedJob);

    if (saveInto) await tx.update(jobs).set(job).where(eq(jobs.id, saveInto));
    const jobId = saveInto ?? (await tx.insert(jobs).values(job).returning({ id: jobs.id }))[0]!.id;
    await tx.insert(jobListings).values({ source, sourceJobId, sourceUrl, jobId })
      .onConflictDoUpdate({ target: [jobListings.source, jobListings.sourceJobId], set: { sourceUrl, jobId } });
    if (deleteJob) await tx.delete(jobs).where(eq(jobs.id, deleteJob));
    return saveInto === null;
  });
}
