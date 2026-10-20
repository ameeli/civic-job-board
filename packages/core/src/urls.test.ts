import { describe, expect, it } from "vitest";
import { employerDomain, linkKeys, normalizeUrl, parseAtsLink } from "./urls";

describe("normalizeUrl", () => {
  it("drops www, tracking parameters, fragments, and trailing slashes", () => {
    expect(
      normalizeUrl("https://WWW.Example.org/jobs/42/?utm_source=x&b=2&a=1&ref=homepage#apply"),
    ).toBe("example.org/jobs/42?a=1&b=2");
  });

  it("rejects non-http links", () => {
    expect(normalizeUrl("mailto:jobs@example.org")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
    expect(normalizeUrl(null)).toBeNull();
  });
});

describe("parseAtsLink", () => {
  it.each([
    ["https://job-boards.greenhouse.io/raft/jobs/6224571004", { provider: "greenhouse", orgSlug: "raft", jobId: "6224571004" }],
    ["https://boards.greenhouse.io/embed/job_app?for=raft&token=6224571004", { provider: "greenhouse", orgSlug: "raft", jobId: "6224571004" }],
    ["https://pbgtech.com/about/careers/jobs/?gh_jid=4720571006", { provider: "greenhouse", orgSlug: null, jobId: "4720571006" }],
    ["https://jobs.lever.co/schmidt-entities/6bef9879-f540", { provider: "lever", orgSlug: "schmidt-entities", jobId: "6bef9879-f540" }],
    ["https://jobs.ashbyhq.com/resend/2e3d92c5", { provider: "ashby", orgSlug: "resend", jobId: "2e3d92c5" }],
    ["https://alkami.wd12.myworkdayjobs.com/en-US/Alkami/job/US-Remote/Software-Engineer--MANTL-_JR-000780-1", { provider: "workday", orgSlug: "alkami", jobId: "JR-000780-1" }],
    ["https://accessnow.bamboohr.com/careers/238", { provider: "bamboohr", orgSlug: "accessnow", jobId: "238" }],
    ["https://apply.workable.com/centre-for-information-resilience/j/8C90C95095", { provider: "workable", orgSlug: "centre-for-information-resilience", jobId: "8C90C95095" }],
    ["https://jobs.diversifytech.com/job/2463447-mid-level-software-engineer-perpay", { provider: "diversifytech", orgSlug: null, jobId: "2463447" }],
    ["https://techjobsforgood.com/jobs/37065/", { provider: "techjobsforgood", orgSlug: null, jobId: "37065" }],
  ])("recognizes %s", (url, expected) => {
    expect(parseAtsLink(url)).toEqual(expected);
  });

  it("returns null for other links", () => {
    expect(parseAtsLink("https://www.packard.org/job/special-initiatives-program-officer/")).toBeNull();
  });
});

describe("linkKeys", () => {
  it("gives two styles of link to the same Greenhouse job a shared key", () => {
    const a = linkKeys("https://www.samsara.com/company/careers/roles/8141959?gh_jid=8141959");
    const b = linkKeys("https://job-boards.greenhouse.io/samsara/jobs/8141959?utm_source=newsletter");
    expect(a.filter((key) => b.includes(key))).toEqual(["ats:greenhouse:8141959"]);
  });

  it("matches a newsletter's short board link with the board's own link", () => {
    const newsletter = linkKeys("https://jobs.diversifytech.com/job/2463447?utm_campaign=diversify-tech-408");
    const board = linkKeys("https://jobs.diversifytech.com/job/2463447-mid-level-software-engineer-perpay");
    expect(newsletter).toContain("ats:diversifytech:2463447");
    expect(board).toContain("ats:diversifytech:2463447");
  });

  it("does not use JazzHR codes, which can repeat across jobs", () => {
    expect(linkKeys("https://analyticallc.applytojob.com/apply/VFbMwfkqm0/Data-Architect")).toEqual([
      "url:analyticallc.applytojob.com/apply/VFbMwfkqm0/Data-Architect",
    ]);
  });
});

describe("employerDomain", () => {
  it("reduces an employer's own link to its registrable domain", () => {
    expect(employerDomain("https://careers.bixal.com/jobs/1")).toBe("bixal.com");
    expect(employerDomain("https://www.first5alameda.org/")).toBe("first5alameda.org");
    expect(employerDomain("https://demos.co.uk/associate-director")).toBe("demos.co.uk");
    expect(employerDomain("https://edd.ca.gov/jobs")).toBe("edd.ca.gov");
  });

  it("ignores ATS, job board, and document hosts", () => {
    expect(employerDomain("https://job-boards.greenhouse.io/raft/jobs/1")).toBeNull();
    expect(employerDomain("https://docs.google.com/document/d/1/edit")).toBeNull();
    expect(employerDomain("https://techjobsforgood.com/jobs/1/")).toBeNull();
  });
});
