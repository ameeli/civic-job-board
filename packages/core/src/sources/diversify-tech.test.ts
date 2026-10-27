import { describe, expect, it } from "vitest";
import { diversifyTech } from "./diversify-tech";
import { fakeHttp, testContext } from "./fake-http";

const routes = {
  "https://jobs.diversifytech.com/sitemap-jobs.xml": { fixture: "diversify-tech/sitemap-jobs.xml" },
  "https://jobs.diversifytech.com/job/2463447-mid-level-software-engineer-perpay": {
    fixture: "diversify-tech/job-2463447.html",
  },
};

describe("Diversify Tech", () => {
  it("reads new jobs from the page's JSON-LD and embedded job record", async () => {
    const http = fakeHttp(routes);

    const result = await diversifyTech.fetchJobs(testContext(http, { "2236217": { version: null } }));

    expect(result.listedIds).toEqual(["2463447", "2236217"]);
    expect(result.partial).toBe(false);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({
      externalId: "2463447",
      title: "Mid-Level Software Engineer",
      orgName: "Perpay",
      orgWebsite: "https://perpay.com/",
      location: "Philadelphia, PA, USA",
      remoteType: null,
      salary: { min: 110000, max: 150000, currency: "USD", period: "year" },
      applyUrl: "https://grnh.se/dayo96hh7us",
      postedAt: new Date("2026-10-13T00:00:00Z"),
      expiresAt: new Date("2026-11-27T00:00:00Z"),
      boardTags: [
        { axis: "category", tag: "Software Engineering" },
        { axis: "level", tag: "Mid-Level" },
        { axis: "job_type", tag: "Full-time" },
      ],
    });
    expect(result.jobs[0]!.description).toMatch(/^About Us:/);
    // The stored copy keeps the JSON-LD but not the page's scripts (which hold a recruiter's email).
    expect(result.jobs[0]!.page!.html).not.toContain("var job_json");
    expect(JSON.stringify(result.jobs[0])).not.toMatch(/@(?!example\.com)[a-z]+\.[a-z]+/);
  });

  it("stops at the deadline", async () => {
    const result = await diversifyTech.fetchJobs(
      testContext(fakeHttp(routes), {}, { deadline: new Date(0) }),
    );

    expect(result).toMatchObject({ jobs: [], partial: true });
  });
});
