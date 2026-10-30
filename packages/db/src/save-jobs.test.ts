import { expect, it } from "vitest";
import { saveJob } from "./save-jobs";
import { eq } from "drizzle-orm";
import { jobs } from "./schema";
import { createTestDb } from "./testing";

it("saves and updates the same source/id without replacing its identity", async () => {
  const db = await createTestDb();
  const job = { source: "tech-jobs-for-gov", sourceJobId: "4296", title: "Engineer",
    employerName: "State", location: "Baton Rouge, LA", salary: "126252",
    description: "Description", applyUrl: "https://example.org/apply",
    sourceUrl: "https://example.org/job", postedAt: new Date("2026-10-27T23:31:22Z"),
    deadline: "2026-11-06" };
  expect(await saveJob(db, job)).toBe(true);
  const [saved] = await db.select().from(jobs).where(eq(jobs.source, job.source));
  expect(saved).toMatchObject(job);
  expect(await saveJob(db, { ...job, title: "Senior Engineer", salary: "Negotiable" })).toBe(false);
  expect(await db.select().from(jobs).where(eq(jobs.source, job.source))).toEqual([{ ...saved, title: "Senior Engineer", salary: "Negotiable" }]);
  expect(await saveJob(db, { ...job, source: "another-source" })).toBe(true);
  expect(await db.select().from(jobs).where(eq(jobs.source, job.source))).toHaveLength(1);
});
