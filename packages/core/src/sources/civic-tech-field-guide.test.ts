import { describe, expect, it } from "vitest";
import { civicTechFieldGuide, splitTitleAtEmployer } from "./civic-tech-field-guide";
import { fakeHttp, testContext } from "./fake-http";

const FEED = "https://civictech.guide/api/v1/feed.xml?kind=jobs&limit=100";
const LEVER = "https://jobs.lever.co/schmidt-entities/6bef9879-f540-475e-ad26-5254fa4e1ad7";

describe("Civic Tech Field Guide", () => {
  it("reads the feed and each new job's apply page", async () => {
    const http = fakeHttp(
      {
        [FEED]: { fixture: "civic-tech-field-guide/feed.xml" },
        [LEVER]: { fixture: "civic-tech-field-guide/apply-lever.html" },
      },
      { status: 404 },
    );

    const result = await civicTechFieldGuide.fetchJobs(testContext(http));

    expect(result.listedIds).toBeNull();
    expect(result.jobs).toHaveLength(4);
    expect(result.jobs[0]).toMatchObject({
      externalId: "recY5rZXzRKsVxN70",
      title: "East Africa Programme Officer",
      orgName: null,
      location: "Addis Ababa, Ethiopia (Remote)",
      remoteType: "remote",
      // "$2,093,000 - $2,898,000" is not plausible yearly pay, so it is dropped.
      salary: null,
      applyUrl: "https://idc.bamboohr.com/careers/48?source=aWQ9MTk%3D",
      expiresAt: new Date("2026-11-08T00:00:00Z"),
      postedAt: new Date("2026-10-19T00:00:00Z"),
    });
    expect(result.jobs[0]!.page).toBeUndefined();
    expect(result.jobs[2]).toMatchObject({
      location: "On site (Cambridge, MA)",
      remoteType: "onsite",
      salary: { min: 63200, max: 80050, currency: "USD", period: "year" },
    });
    const lever = result.jobs[3]!;
    expect(lever).toMatchObject({
      // Lever's JSON-LD names this account "jobs", which is not an employer, so the title's is used.
      title: "Fellow in Residence",
      orgName: "Schmidt Sciences",
      location: "On site (New York, NY)",
      salary: { min: 160000, max: null, currency: "USD", period: "year" },
      expiresAt: new Date("2026-12-15T00:00:00Z"),
    });
    expect(lever.description).toMatch(/Schmidt Sciences/);
    expect(lever.page?.url).toBe(LEVER);
  });

  it("does not refetch apply pages of known jobs", async () => {
    const http = fakeHttp({ [FEED]: { fixture: "civic-tech-field-guide/feed.xml" } });

    const result = await civicTechFieldGuide.fetchJobs(
      testContext(http, {
        recY5rZXzRKsVxN70: { version: null },
        recfUVDZKNekY7gU1: { version: null },
        rec3M73a0lbgUt4HY: { version: null },
        recwMBtdfyutRZCUp: { version: null },
      }),
    );

    expect(result.jobs).toHaveLength(4);
    expect(http.requested).toEqual([FEED]);
  });
});

describe("splitTitleAtEmployer", () => {
  it.each([
    ["Data Scientist at Candid", { title: "Data Scientist", orgName: "Candid" }],
    ["Senior Director, Communications & Marketing at Run for Something", { title: "Senior Director, Communications & Marketing", orgName: "Run for Something" }],
    ["Engineer at large scale systems", { title: "Engineer at large scale systems", orgName: null }],
    ["Program Coordinator", { title: "Program Coordinator", orgName: null }],
  ])("splits %s", (title, expected) => {
    expect(splitTitleAtEmployer(title)).toEqual(expected);
  });
});
