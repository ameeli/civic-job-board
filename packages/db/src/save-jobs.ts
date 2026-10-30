import { and, eq } from "drizzle-orm";
import { jobs, type NewJob } from "./schema";
import type { Db } from "./source-runs";

/** Insert first so overlapping checks count only genuinely new rows. */
export async function saveJob(db: Db, job: NewJob): Promise<boolean> {
  const inserted = await db.insert(jobs).values(job).onConflictDoNothing({
    target: [jobs.source, jobs.sourceJobId],
  }).returning({ id: jobs.id });
  if (inserted.length) return true;
  await db.update(jobs).set(job).where(and(
    eq(jobs.source, job.source), eq(jobs.sourceJobId, job.sourceJobId),
  ));
  return false;
}
