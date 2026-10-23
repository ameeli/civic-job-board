import { describe, expect, it } from "vitest";
import { dscovery } from "./dscovery";
import { TEST_NOW, fakeHttp, testContext } from "./fake-http";

const routes = {
  "https://dscovery.fly.dev/": { fixture: "dscovery/home.html" },
  "https://dscovery.fly.dev/feed/jobs": { fixture: "dscovery/feed.xml" },
};

describe("DSCovery", () => {
  it("lists every job in the home page tables and merges in feed-only jobs", async () => {
    const http = fakeHttp(routes, { status: 404 });

    const result = await dscovery.fetchJobs(testContext(http));

    const a1m = result.jobs.find((job) => job.title === "Senior Software Engineer (Front End)");
    expect(a1m).toMatchObject({
      externalId: "job-boards.greenhouse.io/a1msolutions/jobs/8031656003",
      orgName: "A1M",
      location: "US-based remote",
      remoteType: "remote",
      applyUrl: "https://job-boards.greenhouse.io/a1msolutions/jobs/8031656003",
      postedAt: new Date(TEST_NOW.getTime() - 4 * 86_400_000),
      boardTags: [{ axis: "practice", tag: "Engineering & Development" }],
    });
    const highlighted = result.jobs.filter((job) => job.title.startsWith("Director, Federal Healthcare"));
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0]!.orgName).toBe("Analytica");
    expect(result.jobs.find((job) => job.title === "Program Manager" && job.orgName === "Oddball")).toMatchObject({
      externalId: "job-boards.greenhouse.io/oddball/jobs/8017273003",
      location: null,
    });
    expect(result.listedIds).toHaveLength(result.jobs.length);
    expect(result.listedIds).toContain("pbgtech.com/about/careers/jobs?gh_jid=4720571006");
  });

  it("only fetches apply pages for new jobs", async () => {
    const http = fakeHttp(routes, { status: 404 });
    const first = await dscovery.fetchJobs(testContext(http));
    const known = Object.fromEntries(first.listedIds!.map((id) => [id, { version: null }]));
    const http2 = fakeHttp(routes);

    await dscovery.fetchJobs(testContext(http2, known));

    expect(http2.requested.sort()).toEqual(Object.keys(routes).sort());
  });
});
