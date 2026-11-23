import { beforeEach, expect, it } from "vitest";
import type { Db } from "./client";
import { readJob } from "./read-jobs";
import { saveListing } from "./save-listing";
import { jobs } from "./schema";
import { createTestDb } from "./testing";

let db: Db;

// Keep cold Postgres startup and migrations outside the behavior test timeout.
beforeEach(async () => {
  db = await createTestDb();
});

const listing = (source: string) => ({
  source, sourceJobId: "1", sourceUrl: `https://${source}.example/jobs/1`, title: "Data Analyst",
  employerName: "City", location: "Remote", salary: "$90,000", description: "Analyze data.",
  applyUrl: "https://city.example/apply", postedAt: new Date("2026-10-20T00:00:00Z"),
});

it("reads one job with every listing of it", async () => {
  await saveListing(db, listing("tech-jobs-for-gov"));
  await saveListing(db, listing("dscovery"));
  const { id } = (await db.select({ id: jobs.id }).from(jobs))[0]!;

  expect(await readJob(db, id)).toMatchObject({
    id, title: "Data Analyst", employerName: "City", location: "Remote", salary: "$90,000",
    description: "Analyze data.", applyUrl: "https://city.example/apply", postedAt: new Date("2026-10-20T00:00:00Z"),
    summary: null,
    listings: [
      { source: "dscovery", sourceUrl: "https://dscovery.example/jobs/1" },
      { source: "tech-jobs-for-gov", sourceUrl: "https://tech-jobs-for-gov.example/jobs/1" },
    ],
  });
});

it("reads no job for an unknown or malformed id", async () => {
  expect(await readJob(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
  expect(await readJob(db, "not-a-job")).toBeNull();
});
