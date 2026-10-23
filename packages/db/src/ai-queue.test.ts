import type { JobTagging, NormalizedJob } from "@civic-job-board/core";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { countReadyAiJobs, nextAiBatch, recordAiFailure, saveAiTagging } from "./ai-queue";
import { ingestSourceResult } from "./jobs";
import { aiQueue, jobSightings, jobTags, jobs, organizations } from "./schema";
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

  it.each([
    [false, false], [true, false], [true, true],
  ])("refreshes derived AI metadata after reassociation (target=%s, unchanged target=%s)", async (targetExists, unchangedTarget) => {
    const posting = (overrides: Partial<NormalizedJob> = {}): NormalizedJob => ({
      externalId: "gov", sourceUrl: "https://gov.example/jobs/1001", title: "Data Engineer",
      orgName: "Civic Org", orgWebsite: null, location: "Remote", remoteType: "remote",
      salary: null, description: "Build transport data systems.", applyUrl: null,
      postedAt: null, boardTags: [{ axis: "category", tag: "Transport" }], ...overrides,
    });
    const store = (source: string, job: NormalizedJob) => ingestSourceResult(db, {
      source, now: NOW, result: { jobs: [job], listedIds: null, partial: false },
    });
    await store("tech-jobs-for-gov", posting());
    await store("civic-tech-field-guide", posting({ externalId: "field", sourceUrl: "https://field.example/jobs/1002", applyUrl: "https://job-boards.greenhouse.io/civic/jobs/111", description: "Build healthcare data systems.", boardTags: [{ axis: "category", tag: "Healthcare" }] }));
    const original = (await db.select().from(jobs))[0]!.id;
    await saveAiTagging(db, tagging(original, { summary: "Transport summary", organization: null }), NOW);
    const applyUrl = "https://job-boards.greenhouse.io/civic/jobs/222";
    let target: number | undefined;
    if (targetExists) {
      await store("dscovery", posting({ externalId: "target", sourceUrl: applyUrl, applyUrl, description: unchangedTarget ? "Build transport data systems." : "An older description." }));
      target = (await db.select().from(jobSightings)).find((s) => s.source === "dscovery")!.jobId;
      await saveAiTagging(db, tagging(target, { summary: "Destination summary", organization: null }), NOW);
    }
    const updated = posting({ applyUrl });
    await store("tech-jobs-for-gov", updated);
    const destination = (await db.select().from(jobSightings)).find((s) => s.source === "tech-jobs-for-gov")!.jobId;
    if (targetExists) expect(destination).toBe(target);
    expect((await db.select().from(jobs).where(eq(jobs.id, original)))[0]).toMatchObject({ summary: null, aiTaggedAt: null });
    const oldTags = (await db.select().from(jobTags)).filter((t) => t.jobId === original);
    expect(oldTags).toEqual([expect.objectContaining({ origin: "board", tag: "Healthcare" })]);
    const destinationJob = (await db.select().from(jobs).where(eq(jobs.id, destination)))[0]!;
    expect(destinationJob.summary).toBe(unchangedTarget ? "Destination summary" : null);
    expect(destinationJob.aiTaggedAt).toEqual(unchangedTarget ? NOW : null);
    const batch = await nextAiBatch(db, { limit: 5, now: NOW });
    expect(batch.find((j) => j.id === String(original))).toMatchObject({ description: "Build healthcare data systems.", boardTags: ["Healthcare"] });
    expect(batch.map((j) => j.id).sort()).toEqual((unchangedTarget ? [String(original)] : [String(original), String(destination)]).sort());
    if (!unchangedTarget) {
      expect(batch.find((j) => j.id === String(destination))).toMatchObject({ description: "Build transport data systems.", boardTags: ["Transport"] });
      expect((await db.select().from(jobTags)).filter((t) => t.jobId === destination && t.origin === "ai")).toEqual([]);
    }
    for (const pending of batch) {
      await saveAiTagging(db, tagging(Number(pending.id), { summary: "Updated summary", organization: null }), NOW);
    }
    await store("tech-jobs-for-gov", updated);
    expect(await countReadyAiJobs(db, NOW)).toBe(0);
    expect((await db.select().from(jobs).where(eq(jobs.id, original)))[0]!.summary).toBe("Updated summary");
  });

  it.each<Partial<NormalizedJob>>([
    { title: "Updated role" }, { orgName: "Updated Employer" }, { location: "Remote" },
    { description: "Updated public description." }, { boardTags: [{ axis: "category", tag: "Science" }] },
  ])("requeues changed tagging inputs: %j", async (changed) => {
    const id = await seedJob(db, { orgName: "Schmidt Sciences" });
    const [sighting] = await db.select().from(jobSightings);
    await saveAiTagging(db, tagging(id), NOW);
    await ingestSourceResult(db, {
      source: sighting!.source, now: NOW,
      result: { listedIds: null, partial: false, jobs: [{
        ...sighting!.data, externalId: sighting!.externalId, sourceUrl: sighting!.sourceUrl,
        postedAt: null, expiresAt: null, ...changed,
      }] },
    });

    expect((await db.select().from(jobs))[0]).toMatchObject({ summary: null, aiTaggedAt: null });
    expect((await db.select().from(jobTags)).filter((t) => t.origin === "ai")).toEqual([]);
    expect(await countReadyAiJobs(db, NOW)).toBe(1);
    expect(await nextAiBatch(db, { limit: 5, now: NOW })).toHaveLength(1);
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
