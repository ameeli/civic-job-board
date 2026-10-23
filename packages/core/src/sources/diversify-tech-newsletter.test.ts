import { describe, expect, it } from "vitest";
import { AROUND_THE_WEB, FROM_JOB_BOARD, diversifyTechNewsletter } from "./diversify-tech-newsletter";
import { fakeHttp, testContext } from "./fake-http";

describe("Diversify Tech newsletter", () => {
  it("splits recent issues into one job per line, labelled by list", async () => {
    const http = fakeHttp({
      "https://rss.beehiiv.com/feeds/C62C2GAygE.xml": { fixture: "diversify-tech-newsletter/feed.xml" },
    });

    const result = await diversifyTechNewsletter.fetchJobs(testContext(http));

    expect(result.listedIds).toBeNull();
    const board = result.jobs.filter((job) => job.via === FROM_JOB_BOARD);
    const web = result.jobs.filter((job) => job.via === AROUND_THE_WEB);
    expect(board).toHaveLength(5);
    expect(web.length).toBeGreaterThan(5);
    expect(board[0]).toMatchObject({
      externalId: "jobs.diversifytech.com/job/2558803",
      sourceUrl: "https://newsletter.diversifytech.com/p/diversify-tech-408",
      title: "Managing Director",
      orgName: "Movement Labs",
      location: "Remote - US",
      remoteType: "remote",
      salary: { min: 200000, max: 250000, currency: "USD", period: "year" },
      postedAt: new Date("2026-10-15T00:00:00Z"),
    });
    expect(board[2]).toMatchObject({
      title: "Senior Software Engineer, Fullstack/Frontend/Backend",
      orgName: "Perpay",
      location: "Philadelphia, PA, USA",
    });
    expect(web[0]).toMatchObject({
      title: "Data Scientist I",
      orgName: "CareSource",
      location: "Remote - US",
      salary: null,
      boardTags: [{ axis: "section", tag: "Data" }],
    });
    expect(web.find((job) => job.title === "Software Engineer (MANTL)")).toMatchObject({
      orgName: "Alkami",
      applyUrl: expect.stringContaining("alkami.wd12.myworkdayjobs.com"),
    });
  });

  it("ignores issues older than the reading window", async () => {
    const http = fakeHttp({
      "https://rss.beehiiv.com/feeds/C62C2GAygE.xml": { fixture: "diversify-tech-newsletter/feed.xml" },
    });

    const result = await diversifyTechNewsletter.fetchJobs(
      testContext(http, {}, { now: new Date("2027-03-01T00:00:00Z") }),
    );

    expect(result.jobs).toEqual([]);
  });
});
