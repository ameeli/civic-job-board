import type { NormalizedJob, SourceResult } from "@civic-job-board/core";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ingestSourceResult,
  knownJobs,
  mergeSightingData,
  toSightingData,
  trimPageCopies,
  updateJobStatuses,
} from "./jobs";
import { aiQueue, jobSightings, jobTags, jobs, organizations, pageCopies } from "./schema";
import type { Db } from "./source-runs";
import { createTestDb } from "./testing";

const DAY = 86_400_000;
const NOW = new Date("2026-10-20T13:00:00Z");
const later = (days: number) => new Date(NOW.getTime() + days * DAY);

function job(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    externalId: "1",
    sourceUrl: "https://board.example/jobs/1",
    title: "Senior Software Engineer",
    orgName: "Code for Somewhere",
    orgWebsite: null,
    location: "Remote - US",
    remoteType: "remote",
    salary: { min: 150000, max: 180000, currency: "USD", period: "year" },
    description: "Build things.",
    applyUrl: "https://job-boards.greenhouse.io/codeforsomewhere/jobs/555",
    postedAt: new Date("2026-10-18T00:00:00Z"),
    expiresAt: null,
    boardTags: [{ axis: "category", tag: "Engineering" }],
    ...overrides,
  };
}

function listing(jobsIn: NormalizedJob[], listedIds: string[] | null = jobsIn.map((j) => j.externalId)): SourceResult {
  return { jobs: jobsIn, listedIds, partial: false };
}

async function ingest(db: Db, source: string, result: SourceResult, now = NOW, sharedSourceUrls = false) {
  return ingestSourceResult(db, { source, result, now, sharedSourceUrls });
}

describe("ingestSourceResult", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("stores a new job with its employer, board tags, page copy, and AI queue entry", async () => {
    const result = await ingest(
      db,
      "tech-jobs-for-gov",
      listing([job({ orgWebsite: "https://www.codeforsomewhere.org/", page: { url: "https://board.example/jobs/1", html: "<p>copy</p>" } })]),
    );

    expect(result).toEqual({ seen: 1, new: 1 });
    const [stored] = await db.select().from(jobs);
    expect(stored).toMatchObject({
      title: "Senior Software Engineer",
      location: "Remote - US",
      remoteType: "remote",
      salaryMin: 150000,
      salaryMax: 180000,
      salaryCurrency: "USD",
      salaryPeriod: "year",
      applyUrl: "https://job-boards.greenhouse.io/codeforsomewhere/jobs/555",
      postedAt: new Date("2026-10-18T00:00:00Z"),
      status: "open",
      firstSeenAt: NOW,
    });
    expect(await db.select().from(organizations)).toEqual([
      expect.objectContaining({
        name: "Code for Somewhere",
        domain: "codeforsomewhere.org",
        aliases: ["name:code for somewhere", "ats:greenhouse:codeforsomewhere"],
      }),
    ]);
    expect(await db.select().from(jobTags)).toEqual([
      { jobId: stored!.id, origin: "board", axis: "category", tag: "Engineering", confidence: null },
    ]);
    expect(await db.select().from(aiQueue)).toHaveLength(1);
    expect(await db.select().from(pageCopies)).toHaveLength(1);
  });

  it("is idempotent: storing the same check twice adds nothing", async () => {
    await ingest(db, "tech-jobs-for-gov", listing([job()]));
    const again = await ingest(db, "tech-jobs-for-gov", listing([job()]));

    expect(again).toEqual({ seen: 1, new: 0 });
    expect(await db.select().from(jobs)).toHaveLength(1);
    expect(await db.select().from(jobSightings)).toHaveLength(1);
    expect(await db.select().from(aiQueue)).toHaveLength(1);
  });

  it("merges the same job from two sources by its ATS job id", async () => {
    await ingest(db, "tech-jobs-for-gov", listing([job()]));
    const result = await ingest(
      db,
      "dscovery",
      listing([
        job({
          externalId: "codeforsomewhere.org/careers?gh_jid=555",
          sourceUrl: "https://codeforsomewhere.org/careers?gh_jid=555",
          applyUrl: "https://codeforsomewhere.org/careers?gh_jid=555",
          title: "Sr. Software Engineer (Remote)",
          orgName: "Code for Somewhere, Inc.",
          salary: null,
          description: null,
        }),
      ]),
    );

    expect(result.new).toBe(1);
    expect(await db.select().from(jobs)).toHaveLength(1);
    expect(await db.select().from(jobSightings)).toHaveLength(2);
    expect(await db.select().from(organizations)).toHaveLength(1);
    // The earlier source in SOURCES order wins each field.
    expect((await db.select().from(jobs))[0]!.title).toBe("Senior Software Engineer");
  });

  it("matches a newsletter's link to a board job with the board's own sighting", async () => {
    await ingest(
      db,
      "diversify-tech",
      listing([
        job({
          externalId: "2463447",
          sourceUrl: "https://jobs.diversifytech.com/job/2463447-mid-level-software-engineer-perpay",
          applyUrl: "https://grnh.se/dayo96hh7us",
          title: "Mid-Level Software Engineer",
          orgName: "Perpay",
        }),
      ]),
    );
    await ingest(
      db,
      "diversify-tech-newsletter",
      listing(
        [
          job({
            externalId: "jobs.diversifytech.com/job/2463447",
            sourceUrl: "https://newsletter.diversifytech.com/p/diversify-tech-408",
            applyUrl: "https://jobs.diversifytech.com/job/2463447?utm_campaign=x",
            title: "Mid-Level Software Engineer",
            orgName: "Perpay",
            via: "job board",
          }),
          job({
            externalId: "careers.example/other",
            sourceUrl: "https://newsletter.diversifytech.com/p/diversify-tech-408",
            applyUrl: "https://careers.example/other",
            title: "Data Analyst",
            orgName: "Elsewhere",
            via: "around the web",
          }),
        ],
        null,
      ),
      NOW,
      true,
    );

    // Two jobs, not one: the shared issue link does not merge the newsletter's jobs.
    expect(await db.select().from(jobs)).toHaveLength(2);
    const sightings = await db.select().from(jobSightings);
    expect(new Set(sightings.filter((s) => s.data.title === "Mid-Level Software Engineer").map((s) => s.jobId)).size).toBe(1);
  });

  it("merges by employer and a very similar title when pay is compatible", async () => {
    await ingest(db, "tech-jobs-for-good", listing([job({ applyUrl: "https://careers.example/a" })]));
    await ingest(
      db,
      "civic-tech-field-guide",
      listing(
        [
          job({
            externalId: "rec1",
            sourceUrl: "https://careers.example/b",
            applyUrl: "https://careers.example/b",
            title: "Senior Software Engineer - Remote",
            salary: { min: 155000, max: 175000, currency: "USD", period: "year" },
          }),
        ],
        null,
      ),
    );
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it.each([
    ["https://job-boards.greenhouse.io/org/jobs/111", "https://org.example/careers?gh_jid=222", false],
    ["https://job-boards.greenhouse.io/org/jobs/111", "https://org.example/careers?gh_jid=222", true],
    ["https://org.example/careers?gh_jid=222", "https://job-boards.greenhouse.io/org/jobs/111", false],
    ["https://jobs.lever.co/org/111", "https://jobs.lever.co/org/222", false],
    ["https://jobs.ashbyhq.com/org/111", "https://jobs.ashbyhq.com/org/222", false],
  ] as const)("keeps conflicting requisitions apart through title and shared-link matching: %s", async (first, second, shared) => {
    const sharedUrl = "https://board.example/jobs/1001";
    await ingest(db, "tech-jobs-for-good", listing([job({ sourceUrl: sharedUrl, applyUrl: first })]));
    await ingest(db, "dscovery", listing([job({ externalId: "bridge", sourceUrl: sharedUrl, applyUrl: null })]));
    await ingest(db, "civic-tech-field-guide", listing([job({ externalId: "rec1", sourceUrl: shared ? sharedUrl : "https://other.example/jobs/2002", applyUrl: second })]));

    expect(await db.select().from(jobs)).toHaveLength(2);
    const sightings = await db.select().from(jobSightings);
    expect(sightings[0]!.jobId).toBe(sightings[1]!.jobId);
    expect(sightings[2]!.jobId).not.toBe(sightings[0]!.jobId);
  });

  it("keeps jobs apart when the titles match but the pay does not", async () => {
    await ingest(db, "tech-jobs-for-good", listing([job({ applyUrl: "https://careers.example/a" })]));
    await ingest(
      db,
      "civic-tech-field-guide",
      listing(
        [
          job({
            externalId: "rec1",
            sourceUrl: "https://careers.example/b",
            applyUrl: "https://careers.example/b",
            salary: { min: 60000, max: 70000, currency: "USD", period: "year" },
          }),
        ],
        null,
      ),
    );
    expect(await db.select().from(jobs)).toHaveLength(2);
  });

  it("does not merge two jobs that share a generic careers link", async () => {
    await ingest(
      db,
      "tech-jobs-for-gov",
      listing([
        job({ externalId: "1", applyUrl: "https://www.governmentjobs.com/careers/phoenix", title: "AI Product Manager", orgName: "City of Phoenix" }),
        job({ externalId: "2", applyUrl: "https://www.governmentjobs.com/careers/phoenix", title: "Chief Data Officer", orgName: "City of Phoenix" }),
      ]),
    );
    await ingest(
      db,
      "tech-jobs-for-good",
      listing([job({ externalId: "9", applyUrl: "https://www.governmentjobs.com/careers/phoenix", title: "Accountant", orgName: "Phoenix Water" })]),
    );
    expect(await db.select().from(jobs)).toHaveLength(3);
  });

  it("keeps two levels apart when a newsletter and a feed share a careers page link", async () => {
    await ingest(
      db,
      "diversify-tech-newsletter",
      listing(
        [
          job({
            externalId: "org.org/careers",
            sourceUrl: "https://newsletter.diversifytech.com/p/diversify-tech-409",
            applyUrl: "https://org.org/careers",
            title: "Senior Product Manager",
            orgName: "Org",
            salary: null,
            via: "around the web",
          }),
        ],
        null,
      ),
      NOW,
      true,
    );
    await ingest(
      db,
      "dscovery",
      listing([
        job({
          externalId: "org.org/careers",
          sourceUrl: "https://org.org/careers",
          applyUrl: "https://org.org/careers",
          title: "Product Manager",
          orgName: "Org",
          salary: null,
        }),
      ]),
    );
    expect(await db.select().from(jobs)).toHaveLength(2);
  });

  it("does not merge a shared posting link across different employers", async () => {
    await ingest(db, "tech-jobs-for-good", listing([job({ applyUrl: "https://apply.example/posting/7001", orgName: "Org A" })]));
    await ingest(
      db,
      "dscovery",
      listing([job({ externalId: "x", sourceUrl: "https://apply.example/posting/7001", applyUrl: "https://apply.example/posting/7001", orgName: "Org B" })]),
    );
    expect(await db.select().from(jobs)).toHaveLength(2);
  });

  it("merges a shared posting link at one employer", async () => {
    await ingest(db, "tech-jobs-for-good", listing([job({ applyUrl: "https://org.org/careers/senior-software-engineer" })]));
    await ingest(
      db,
      "dscovery",
      listing([
        job({
          externalId: "org.org/careers/senior-software-engineer",
          sourceUrl: "https://org.org/careers/senior-software-engineer",
          applyUrl: "https://org.org/careers/senior-software-engineer?utm_source=dscovery",
          title: "Sr. Software Engineer",
          salary: null,
        }),
      ]),
    );
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("keeps two levels of one role at one employer apart", async () => {
    await ingest(
      db,
      "tech-jobs-for-good",
      listing([job({ applyUrl: "https://careers.example/a", title: "Software Engineer", salary: null })]),
    );
    await ingest(
      db,
      "civic-tech-field-guide",
      listing(
        [job({ externalId: "rec2", sourceUrl: "https://careers.example/b", applyUrl: "https://careers.example/b", title: "Software Engineer II", salary: null })],
        null,
      ),
    );
    expect(await db.select().from(jobs)).toHaveLength(2);
  });

  it("finds the employer of an unnamed job by its ATS account", async () => {
    await ingest(db, "dscovery", listing([job({ orgName: "Raft", applyUrl: "https://job-boards.greenhouse.io/raft/jobs/1" })]));
    await ingest(
      db,
      "civic-tech-field-guide",
      listing([job({ externalId: "rec9", orgName: null, title: "Contracts Manager", applyUrl: "https://job-boards.greenhouse.io/raft/jobs/2" })], null),
    );
    const rows = await db.select().from(jobs);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.organizationId)).size).toBe(1);
  });

  it("does not erase what an earlier check found", async () => {
    await ingest(db, "civic-tech-field-guide", listing([job({ externalId: "rec1" })], null));
    await ingest(db, "civic-tech-field-guide", listing([job({ externalId: "rec1", description: null, orgName: null, title: "Senior Software Engineer (updated)" })], null), later(1));

    const [stored] = await db.select().from(jobs);
    expect(stored).toMatchObject({ description: "Build things.", title: "Senior Software Engineer (updated)" });
    expect(await knownJobs(db, "civic-tech-field-guide")).toEqual(new Map([["rec1", { version: null }]]));
  });
});

describe("closure", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("closes a job missing from its source's listing for three checks, and reopens it when it returns", async () => {
    await ingest(db, "tech-jobs-for-gov", listing([job()]));
    for (const day of [1, 2]) {
      await ingest(db, "tech-jobs-for-gov", listing([], ["other"]), later(day));
      await updateJobStatuses(db, later(day));
    }
    expect((await db.select().from(jobs))[0]!.status).toBe("open");

    // A second run on the same day does not count again.
    await ingest(db, "tech-jobs-for-gov", listing([], ["other"]), new Date(later(2).getTime() + 3_600_000));
    await updateJobStatuses(db, later(2));
    expect((await db.select().from(jobs))[0]!.status).toBe("open");

    await ingest(db, "tech-jobs-for-gov", listing([], ["other"]), later(3));
    expect(await updateJobStatuses(db, later(3))).toEqual({ closed: 1, reopened: 0 });
    expect((await db.select().from(jobs))[0]).toMatchObject({ status: "closed", closedReason: "gone", closedAt: later(3) });

    await ingest(db, "tech-jobs-for-gov", listing([], ["1"]), later(4));
    expect(await updateJobStatuses(db, later(4))).toEqual({ closed: 0, reopened: 1 });
    expect((await db.select().from(jobs))[0]).toMatchObject({ status: "open", closedAt: null });
  });

  it("ignores an empty listing, which means the source broke", async () => {
    await ingest(db, "tech-jobs-for-gov", listing([job()]));
    for (const day of [1, 2, 3, 4]) {
      await ingest(db, "tech-jobs-for-gov", listing([], []), later(day));
    }
    await updateJobStatuses(db, later(4));
    expect((await db.select().from(jobs))[0]!.status).toBe("open");
  });

  it("keeps a job open while another source still lists it", async () => {
    await ingest(db, "tech-jobs-for-gov", listing([job()]));
    await ingest(db, "dscovery", listing([job({ externalId: "x" })]));
    for (const day of [1, 2, 3]) {
      await ingest(db, "tech-jobs-for-gov", listing([], ["other"]), later(day));
      await ingest(db, "dscovery", listing([], ["x"]), later(day));
    }
    await updateJobStatuses(db, later(3));
    expect((await db.select().from(jobs))[0]!.status).toBe("open");
  });

  it("closes a feed-only job a month after the feed last showed it", async () => {
    await ingest(db, "civic-tech-field-guide", listing([job({ externalId: "rec1" })], null));
    await ingest(db, "civic-tech-field-guide", listing([], null), later(29));
    await updateJobStatuses(db, later(29));
    expect((await db.select().from(jobs))[0]!.status).toBe("open");

    await ingest(db, "civic-tech-field-guide", listing([], null), later(31));
    await updateJobStatuses(db, later(31));
    expect((await db.select().from(jobs))[0]).toMatchObject({ status: "closed", closedReason: "gone" });
  });

  it("closes a job once its deadline passes", async () => {
    await ingest(db, "tech-jobs-for-gov", listing([job({ expiresAt: later(2) })]));
    await updateJobStatuses(db, later(1));
    expect((await db.select().from(jobs))[0]!.status).toBe("open");
    await updateJobStatuses(db, later(3));
    expect((await db.select().from(jobs))[0]).toMatchObject({ status: "closed", closedReason: "expired" });
  });

  it("preserves an omitted deadline and reopens after an authoritative clear", async () => {
    await ingest(db, "tech-jobs-for-gov", listing([job({ expiresAt: later(1) })]));
    await ingest(db, "dscovery", listing([job({ externalId: "other", expiresAt: later(1) })]));
    expect(await updateJobStatuses(db, later(2))).toEqual({ closed: 1, reopened: 0 });

    await ingest(db, "tech-jobs-for-gov", listing([job({ expiresAt: undefined, description: null })]), later(3));
    expect(await updateJobStatuses(db, later(3))).toEqual({ closed: 0, reopened: 0 });
    expect((await db.select().from(jobs))[0]!.expiresAt).toEqual(later(1));

    await ingest(db, "tech-jobs-for-gov", listing([job({ expiresAt: null, description: null })]), later(4));
    expect(await updateJobStatuses(db, later(4))).toEqual({ closed: 0, reopened: 1 });
    expect((await db.select().from(jobs))[0]).toMatchObject({ expiresAt: null, status: "open", closedAt: null, description: "Build things." });
    expect((await db.select().from(jobSightings)).find((s) => s.source === "tech-jobs-for-gov")!.data.expiresAt).toBeNull();

    await ingest(db, "tech-jobs-for-gov", listing([job({ expiresAt: later(8) })]), later(5));
    expect((await db.select().from(jobs))[0]!.expiresAt).toEqual(later(8));
  });

  it("trims page copies of jobs closed more than 90 days ago and keeps the jobs", async () => {
    await ingest(db, "tech-jobs-for-gov", listing([job({ expiresAt: later(1), page: { url: "u", html: "<p>x</p>" } })]));
    await updateJobStatuses(db, later(2));

    expect(await trimPageCopies(db, later(91))).toBe(0);
    expect(await trimPageCopies(db, later(93))).toBe(1);
    expect(await db.select().from(pageCopies)).toEqual([]);
    expect(await db.select().from(jobs).where(eq(jobs.status, "closed"))).toHaveLength(1);
  });
});

describe("mergeSightingData", () => {
  it("lets new values win but keeps old ones the new check lacks, and the first posted date", () => {
    const previous = toSightingData(job({ postedAt: new Date("2026-10-01T00:00:00Z") }));
    const next = toSightingData(job({ description: null, boardTags: [], title: "New title", postedAt: new Date("2026-10-05T00:00:00Z") }));

    expect(mergeSightingData(previous, next)).toEqual({
      ...previous,
      title: "New title",
    });
  });
});

describe("employers", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("keeps agencies that share one government ATS account apart", async () => {
    await ingest(
      db,
      "tech-jobs-for-gov",
      listing([
        job({ externalId: "1", orgName: "City of New York Department of Transportation", applyUrl: "https://jobs.smartrecruiters.com/CityOfNewYork/111-analyst" }),
        job({ externalId: "2", orgName: "NYC Housing Authority", title: "Planner", applyUrl: "https://jobs.smartrecruiters.com/CityOfNewYork/222-planner" }),
      ]),
    );
    // An unnamed job on that shared account cannot be placed with either.
    await ingest(
      db,
      "civic-tech-field-guide",
      listing([job({ externalId: "rec1", orgName: null, title: "Engineer", applyUrl: "https://jobs.smartrecruiters.com/CityOfNewYork/333-engineer" })], null),
    );

    expect((await db.select().from(organizations)).map((org) => org.name).sort()).toEqual([
      "City of New York Department of Transportation",
      "NYC Housing Authority",
    ]);
    expect((await db.select().from(jobs)).find((j) => j.title === "Engineer")!.organizationId).toBeNull();
  });
});

