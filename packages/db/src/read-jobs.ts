import { sql } from "drizzle-orm";
import { jobs } from "./schema";
import type { Db } from "./source-runs";

export function readJobs(db: Db) {
  return db.select({
    id: jobs.id, title: jobs.title, employerName: jobs.employerName,
    source: jobs.source, applyUrl: jobs.applyUrl, sourceUrl: jobs.sourceUrl,
  }).from(jobs).orderBy(sql`${jobs.postedAt} desc nulls last`, jobs.id);
}
