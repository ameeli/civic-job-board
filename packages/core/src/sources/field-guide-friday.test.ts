import { describe, expect, it } from "vitest";
import { fakeHttp, testContext } from "./fake-http";
import { fieldGuideFriday, parseIssue } from "./field-guide-friday";

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

  it("keeps two titles on one careers page apart but merges a repeated posting link", () => {
    const paragraph = (href: string, title: string) =>
      `<p>💼 <a href="${href}">${title}</a>, Northwestern University<br/>Hybrid (Evanston, IL)</p>`;
    const login = "https://careers.northwestern.edu/psc/hrnu_er/?cmd=login&errorPg=ckreq&languageCd=ENG";
    const posting = "https://data.org/jobs/program-officer/";
    const jobs = parseIssue(
      `<h1>Open Jobs</h1>${paragraph(login, "Program Coordinator")}${paragraph(login, "Data Analyst")}${paragraph(posting, "Program Officer")}`,
      "https://us19.campaign-archive.com/?u=1&id=2",
      null,
    );

    expect(jobs.map((job) => job.externalId)).toEqual([
      "careers.northwestern.edu/psc/hrnu_er?cmd=login&errorPg=ckreq&languageCd=ENG#program coordinator",
      "careers.northwestern.edu/psc/hrnu_er?cmd=login&errorPg=ckreq&languageCd=ENG#data analyst",
      "data.org/jobs/program-officer",
    ]);
    expect(parseIssue(`<h1>Open Jobs</h1>${paragraph(`${posting}?utm_source=x`, "Program Officer (AI)")}`, "x", null)[0]!.externalId).toBe(
      jobs[2]!.externalId,
    );
  });
});
