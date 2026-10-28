import { expect, it } from "vitest";
import { readSourceJobs, saveJob } from "./save-jobs";
import { createTestDb } from "./testing";

it("saves and updates the same source/id without replacing its identity", async () => {
  const db = await createTestDb();
  const job = { source: "tech-jobs-for-gov", sourceJobId: "4296", title: "Engineer",
    employerName: "State", location: "Baton Rouge, LA", salary: "126252",
    description: "Description", applyUrl: "https://example.org/apply",
    sourceUrl: "https://example.org/job", postedAt: new Date("2026-10-27T23:31:22Z"),
    deadline: "2026-11-06" };
  expect(await saveJob(db, job)).toBe(true);
  const [saved] = await readSourceJobs(db, job.source);
  expect(saved).toMatchObject(job);
  expect(await saveJob(db, { ...job, title: "Senior Engineer", salary: "Negotiable" })).toBe(false);
  expect(await readSourceJobs(db, job.source)).toEqual([{ ...saved, title: "Senior Engineer", salary: "Negotiable" }]);
  expect(await saveJob(db, { ...job, source: "another-source" })).toBe(true);
  expect(await readSourceJobs(db, job.source)).toHaveLength(1);
});
