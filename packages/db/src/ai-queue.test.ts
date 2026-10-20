import type { JobTagging } from "@civic-job-board/core";
import { beforeEach, describe, expect, it } from "vitest";
import { countReadyAiJobs, nextAiBatch, recordAiFailure, saveAiTagging } from "./ai-queue";
import { ingestSourceResult } from "./jobs";
import { aiQueue, jobTags, jobs, organizations } from "./schema";
import type { Db } from "./source-runs";
import { createTestDb } from "./testing";

const NOW = new Date("2026-10-20T13:00:00Z");

async function seedJob(db: Db, overrides: { orgName?: string | null; applyUrl?: string } = {}) {
  await ingestSourceResult(db, {
    source: "civic-tech-field-guide",
    now: NOW,
    result: {
      listedIds: null,
      partial: false,
      jobs: [
        {
          externalId: "rec1",
          sourceUrl: "https://jobs.lever.co/schmidt-entities/abc",
          title: "Fellow in Residence at Schmidt Sciences",
          orgName: overrides.orgName === undefined ? null : overrides.orgName,
          orgWebsite: null,
          location: "New York, NY",
          remoteType: "onsite",
          salary: null,
          description: "Join our science program.",
          applyUrl: overrides.applyUrl ?? "https://jobs.lever.co/schmidt-entities/abc",
          postedAt: null,
          expiresAt: null,
          boardTags: [{ axis: "category", tag: "Fellowship" }],
        },
      ],
    },
  });
  return (await db.select().from(jobs))[0]!.id;
}

function tagging(id: number, overrides: Partial<JobTagging> = {}): JobTagging {
  return {
    id: String(id),
    jobFunction: { tag: "Fellowship/Internship", confidence: 0.9 },
    sectors: [
      { tag: "Other social impact", confidence: 0.7 },
      { tag: "Education", confidence: 0.4 },
    ],
    seniority: "Mid",
    summary: "A residency for a scientist.",
    organization: "Schmidt Sciences",
    ...overrides,
  };
}

describe("AI queue", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("hands out queued jobs with only their public posting fields", async () => {
    const id = await seedJob(db);

    expect(await countReadyAiJobs(db, NOW)).toBe(1);
    expect(await nextAiBatch(db, { limit: 5, now: NOW })).toEqual([
      {
        id: String(id),
        title: "Fellow in Residence at Schmidt Sciences",
        orgName: null,
        location: "New York, NY",
        description: "Join our science program.",
        boardTags: ["Fellowship"],
      },
    ]);
  });

  it("stores tags and the summary, links the employer the model named, and dequeues", async () => {
    const id = await seedJob(db);

    await saveAiTagging(db, tagging(id), NOW);

    expect(await db.select().from(aiQueue)).toEqual([]);
    const [job] = await db.select().from(jobs);
    expect(job).toMatchObject({ summary: "A residency for a scientist.", aiTaggedAt: NOW });
    const [org] = await db.select().from(organizations);
    expect(org).toMatchObject({ name: "Schmidt Sciences", aliases: ["name:schmidt sciences", "ats:lever:schmidt-entities"] });
    expect(job!.organizationId).toBe(org!.id);
    const tags = await db.select().from(jobTags);
    expect(tags.filter((t) => t.origin === "ai").map((t) => [t.axis, t.tag, t.confidence])).toEqual([
      ["function", "Fellowship/Internship", expect.closeTo(0.9)],
      ["sector", "Other social impact", expect.closeTo(0.7)],
      ["sector", "Education", expect.closeTo(0.4)],
      ["seniority", "Mid", null],
    ]);
    expect(tags.filter((t) => t.origin === "board")).toHaveLength(1);
  });

  it("replaces earlier AI tags and keeps an employer a source named", async () => {
    const id = await seedJob(db, { orgName: "Schmidt Sciences" });
    await saveAiTagging(db, tagging(id), NOW);
    await saveAiTagging(db, tagging(id, { sectors: [{ tag: "Health", confidence: 0.8 }], organization: "Someone Else" }), NOW);

    const sectors = (await db.select().from(jobTags)).filter((t) => t.axis === "sector").map((t) => t.tag);
    expect(sectors).toEqual(["Health"]);
    expect(await db.select().from(organizations)).toHaveLength(1);
  });

  it("backs off failed jobs", async () => {
    const id = await seedJob(db);

    await recordAiFailure(db, { jobIds: [id], error: "bad output", now: NOW });

    const [row] = await db.select().from(aiQueue);
    expect(row).toMatchObject({ attempts: 1, lastError: "bad output", availableAt: new Date(NOW.getTime() + 3_600_000) });
    expect(await nextAiBatch(db, { limit: 5, now: NOW })).toEqual([]);
    expect(await nextAiBatch(db, { limit: 5, now: new Date(NOW.getTime() + 3_600_000) })).toHaveLength(1);
  });
});
