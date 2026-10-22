import { describe, expect, it } from "vitest";
import { fakeHttp, testContext } from "./fake-http";
import { techJobsForGood } from "./tech-jobs-for-good";

const ORIGIN = "https://techjobsforgood.com";
const routes = {
  [`${ORIGIN}/sitemap.xml`]: { fixture: "tech-jobs-for-good/sitemap.xml" },
  [`${ORIGIN}/jobs/?page=1`]: { fixture: "tech-jobs-for-good/listing-page-1.html" },
  [`${ORIGIN}/jobs/?page=2`]: { status: 404 },
  [`${ORIGIN}/jobs/37063/`]: { fixture: "tech-jobs-for-good/job-37063.html" },
  [`${ORIGIN}/jobs/37065/`]: { status: 404 },
  [`${ORIGIN}/jobs/37062/`]: { status: 404 },
};

describe("Tech Jobs for Good", () => {
  it("takes only jobs on the free listing and reads each new job's page", async () => {
    const http = fakeHttp(routes);

    const result = await techJobsForGood.fetchJobs(testContext(http));

    expect(result.jobs.map((job) => job.externalId)).toEqual(["37063", "37065", "37062"]);
    expect(result.seen).toBe(3);
    // Premium-only jobs from the sitemap are never fetched.
    expect(http.requested).not.toContain(`${ORIGIN}/jobs/36503/`);
    expect(http.requested).not.toContain(`${ORIGIN}/jobs/36178/`);
    expect(result.jobs[0]).toMatchObject({
      sourceUrl: `${ORIGIN}/jobs/37063/`,
      title: "Technology Consultant: Systems Integration Architecture",
      orgName: "Element14",
      orgWebsite: "https://www.element14.ai/",
      location: "Remote (US) / Washington, DC (preferred)",
      remoteType: "remote",
      salary: { min: 135000, max: 160000, currency: "USD", period: "year" },
      applyUrl: expect.stringMatching(/^https:\/\/docs\.google\.com\/forms\//),
      postedAt: new Date("2026-10-20T00:00:00Z"),
      expiresAt: new Date("2026-11-19T00:00:00Z"),
    });
    expect(result.jobs[0]!.boardTags[0]).toEqual({ axis: "job_function", tag: expect.any(String) });
    expect(result.jobs[0]!.description).toMatch(/Overview/);
  });

  it("keeps a free job from its listing card when its page is missing", async () => {
    const result = await techJobsForGood.fetchJobs(testContext(fakeHttp(routes)));

    expect(result.jobs[1]).toMatchObject({
      title: "Engineering Manager",
      orgName: "First 5 Alameda County",
      location: "Alameda, CA (Hybrid)",
      remoteType: "hybrid",
      salary: { min: 121000, max: 175000, currency: "USD", period: "year" },
      applyUrl: null,
    });
    expect(result.jobs[1]!.boardTags).toContainEqual({ axis: "impact_area", tag: "Education" });
    expect(result.jobs[1]!.boardTags).toContainEqual({ axis: "impact_area", tag: "Economic Development" });
  });

  it("uses the sitemap, which includes premium-only jobs, for the open listing", async () => {
    const result = await techJobsForGood.fetchJobs(
      testContext(fakeHttp(routes), { "37063": { version: null }, "37065": { version: null }, "37062": { version: null } }),
    );

    expect(result.jobs).toEqual([]);
    expect(result.seen).toBe(3);
    expect(result.listedIds!.sort()).toEqual(["36178", "36503", "37062", "37063", "37065"]);
  });

  it("reports an empty free listing even while the premium sitemap is populated", async () => {
    const http = fakeHttp({ ...routes, [`${ORIGIN}/jobs/?page=1`]: { body: "<html></html>" } });
    const result = await techJobsForGood.fetchJobs(testContext(http));

    expect(result.seen).toBe(0);
    expect(result.listedIds).toContain("36503");
    expect(result.jobs).toEqual([]);
    expect(http.requested).toEqual([`${ORIGIN}/sitemap.xml`, `${ORIGIN}/jobs/?page=1`]);
  });

  it("counts free listings even when the deadline prevents fetching new jobs", async () => {
    const result = await techJobsForGood.fetchJobs(testContext(fakeHttp(routes), {}, { deadline: new Date(0) }));

    expect(result).toMatchObject({ jobs: [], seen: 3, partial: true });
    expect(result.listedIds).toContain("36503");
  });

});
