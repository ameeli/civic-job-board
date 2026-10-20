import { describe, expect, it } from "vitest";
import { fakeHttp, testContext } from "./fake-http";
import { fieldGuideFriday } from "./field-guide-friday";

const FEED =
  "https://us19.campaign-archive.com/feed?u=cdb853c4847acff0d0a09460d&id=ca5a70438b";

describe("Field Guide Friday", () => {
  it("reads the Open Jobs section of recent issues", async () => {
    const result = await fieldGuideFriday.fetchJobs(
      testContext(fakeHttp({ [FEED]: { fixture: "field-guide-friday/feed.xml" } })),
    );

    expect(result.listedIds).toBeNull();
    expect(result.jobs.map((job) => job.title)).toEqual([
      "Design Researcher",
      "Program Coordinator",
      "Associate Director, Responsible AI Solutions",
      "Program Officer, AI Model Safety",
      "Director, Data & Integration Services",
      "Associate Director (Digital Policy)",
    ]);
    expect(result.jobs[2]).toMatchObject({
      externalId: "data.org/jobs/associate-director-responsible-ai-solutions",
      orgName: "Ford Foundation",
      location: "Hybrid (New York, NY)",
      remoteType: "hybrid",
      salary: { min: 181000, max: 202000, currency: "USD", period: "year" },
      applyUrl: "https://data.org/jobs/associate-director-responsible-ai-solutions/",
      expiresAt: new Date("2026-10-30T00:00:00Z"),
      postedAt: new Date("2026-10-09T15:08:47Z"),
    });
    // "Superbloom (our fiscal sponsor!!)" loses its aside.
    expect(result.jobs[0]!.orgName).toBe("Superbloom");
    expect(result.jobs[1]).toMatchObject({
      orgName: "Northwestern University",
      salary: { min: 55000, max: null, currency: null, period: "year" },
    });
    expect(result.jobs[5]).toMatchObject({
      orgName: "Demos",
      salary: { min: 52973, max: 69273, currency: "GBP", period: "year" },
    });
  });
});
