import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import type { Db } from "./client";
import { saveJobTags } from "./job-tags";
import { readJobs } from "./read-jobs";
import { saveListing, type JobListing } from "./save-listing";
import { jobListings, jobs } from "./schema";
import { createTestDb } from "./testing";

let db: Db;

// Keep cold Postgres startup and migrations outside the behavior test timeout.
beforeEach(async () => {
  db = await createTestDb();
});

const listing = (source: string, sourceJobId: string, fields: Partial<JobListing> = {}): JobListing => ({
  source, sourceJobId, sourceUrl: `https://${source}.example/${sourceJobId}`,
  title: "Engineer", employerName: "State", location: "Baton Rouge, LA", salary: "126252",
  description: `Description from ${source}`, applyUrl: "https://example.org/apply",
  postedAt: new Date("2026-10-27T23:31:22Z"), deadline: "2026-11-06", ...fields,
});
const listingsOf = async () => (await db.select().from(jobListings))
  .map(row => [row.source, row.sourceJobId, row.jobId]).sort();
const tags = { roleTags: ["security"], sectorTags: ["unknown"], seniority: "senior", summary: null };

it("saves a listing, then updates the same job when the board edits it", async () => {
  expect(await saveListing(db, listing("board", "1"))).toBe(true);
  const [saved] = await db.select().from(jobs);
  expect(saved).toMatchObject({ title: "Engineer", salary: "126252", applyUrl: "https://example.org/apply" });
  await saveJobTags(db, saved!.id, tags);

  expect(await saveListing(db, listing("board", "1", { title: "Senior Engineer", salary: "Negotiable" }))).toBe(false);
  expect(await db.select().from(jobs)).toMatchObject([{ id: saved!.id, title: "Senior Engineer", salary: "Negotiable", ...tags }]);
  expect(await listingsOf()).toEqual([["board", "1", saved!.id]]);
});

it("merges listings with the same apply link and title into one job showing the last saved text", async () => {
  expect(await saveListing(db, listing("gov", "1"))).toBe(true);
  expect(await saveListing(db, listing("guide", "a", { salary: null }))).toBe(false);
  expect(await saveListing(db, listing("gov", "2"))).toBe(false);
  const [job] = await db.select().from(jobs);
  expect(await db.select().from(jobs)).toEqual([expect.objectContaining({ description: "Description from gov", salary: "126252" })]);
  expect(await listingsOf()).toEqual([["gov", "1", job!.id], ["gov", "2", job!.id], ["guide", "a", job!.id]]);
  expect(await readJobs(db)).toMatchObject([{ id: job!.id, sources: ["gov", "guide"] }]);
});

it("keeps jobs apart when only the apply link or only the title matches, or there is no apply link", async () => {
  await saveListing(db, listing("gov", "1"));
  await saveListing(db, listing("guide", "a", { title: "Analyst" }));
  await saveListing(db, listing("guide", "b", { applyUrl: "https://example.org/apply/" }));
  await saveListing(db, listing("guide", "c", { applyUrl: null }));
  await saveListing(db, listing("guide", "d", { applyUrl: null }));
  expect(await db.select().from(jobs)).toHaveLength(5);

  expect(await saveListing(db, listing("guide", "c", { applyUrl: null, title: "Edited" }))).toBe(false);
  expect(await db.select().from(jobs)).toHaveLength(5);
  expect((await readJobs(db)).filter(job => job.applyUrl === null).map(job => job.sourceUrl).sort())
    .toEqual(["https://guide.example/c", "https://guide.example/d"]);
});

it("moves an edited listing into the job it now matches and deletes the job it left empty", async () => {
  await saveListing(db, listing("gov", "1"));
  await saveListing(db, listing("guide", "a", { title: "Engineer I" }));
  const [target] = await db.select().from(jobs).where(eq(jobs.title, "Engineer"));

  expect(await saveListing(db, listing("guide", "a"))).toBe(false);
  expect(await db.select().from(jobs)).toEqual([expect.objectContaining({ id: target!.id })]);
  expect(await listingsOf()).toEqual([["gov", "1", target!.id], ["guide", "a", target!.id]]);
});

it("splits an edited listing off a job another listing still shares", async () => {
  await saveListing(db, listing("gov", "1"));
  await saveListing(db, listing("guide", "a"));
  const [merged] = await db.select().from(jobs);
  await saveJobTags(db, merged!.id, tags);

  expect(await saveListing(db, listing("guide", "a", { title: "Analyst" }))).toBe(true);
  const [split] = await db.select().from(jobs).where(eq(jobs.title, "Analyst"));
  expect(split).toMatchObject({ taggedAt: null });
  expect(await db.select().from(jobs).where(eq(jobs.title, "Engineer"))).toMatchObject([{ id: merged!.id, ...tags }]);
  expect(await listingsOf()).toEqual([["gov", "1", merged!.id], ["guide", "a", split!.id]].sort());
});
