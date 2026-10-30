import { eq, isNull, sql } from "drizzle-orm";
import { jobs } from "./schema";
import type { Db } from "./source-runs";

/** Untagged jobs, oldest posted first, so a backlog clears in order over several runs. */
export function readJobsToTag(db: Db, limit: number) {
  return db.select({
    id: jobs.id, title: jobs.title, employerName: jobs.employerName, description: jobs.description,
  }).from(jobs).where(isNull(jobs.taggedAt))
    .orderBy(sql`${jobs.postedAt} asc nulls last`, jobs.id).limit(limit);
}

export async function saveJobTags(db: Db, jobId: string, tags: {
  roleTags: string[]; sectorTags: string[]; seniority: string; summary: string | null;
}): Promise<void> {
  await db.update(jobs).set({ ...tags, taggedAt: new Date() }).where(eq(jobs.id, jobId));
}
