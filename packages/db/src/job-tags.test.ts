import { expect, it } from "vitest";
import { readJobsToTag, saveJobTags } from "./job-tags";
import { saveJob } from "./save-jobs";
import { jobs } from "./schema";
import { createTestDb } from "./testing";

const job = (sourceJobId: string, postedAt: Date | null) => ({
  source: "tech-jobs-for-gov", sourceJobId, title: `Job ${sourceJobId}`, employerName: "State",
  description: "Description", sourceUrl: `https://example.org/${sourceJobId}`, postedAt,
});

it("reads untagged jobs oldest first and keeps tags when the listing is saved again", async () => {
  const db = await createTestDb();
  await saveJob(db, job("new", new Date("2026-10-20T00:00:00Z")));
  await saveJob(db, job("undated", null));
  await saveJob(db, job("old", new Date("2026-10-01T00:00:00Z")));
  expect((await readJobsToTag(db, 10)).map(row => row.title)).toEqual(["Job old", "Job new", "Job undated"]);

  const [oldest] = await readJobsToTag(db, 1);
  const tags = { roleTags: ["security"], sectorTags: ["unknown"], seniority: "senior", summary: null };
  await saveJobTags(db, oldest!.id, tags);
  expect((await readJobsToTag(db, 10)).map(row => row.title)).toEqual(["Job new", "Job undated"]);

  await saveJob(db, { ...job("old", new Date("2026-10-01T00:00:00Z")), title: "Edited" });
  const [saved] = (await db.select().from(jobs)).filter(row => row.id === oldest!.id);
  expect(saved).toMatchObject({ ...tags, title: "Edited" });
  expect(saved!.taggedAt).toBeInstanceOf(Date);
});
