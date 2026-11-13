import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { fetchDscoveryJobs, mapDscoveryListing, readHomePageJobs } from "./dscovery";

// Live capture, 2026-11-11: the home page trimmed to its Highlighted Jobs table
// with one job, and two employers' All Jobs tables with one job each.
const homePage = readFileSync(new URL("./fixtures/dscovery-home.html", import.meta.url), "utf8");
const [analyticaJob, bixalJob] = readHomePageJobs(homePage);

describe("DSCovery", () => {
  it("reads each All Jobs row once, with its employer from the table caption", () => {
    expect(readHomePageJobs(homePage)).toEqual([
      {
        id: "13534", title: "Senior Cloud & Data Platform Architect", employerName: "Analytica",
        applyUrl: "https://analyticallc.applytojob.com/apply/VFbMwfkqm0/Senior-Cloud-Data-Platform-Architect",
        practices: ["Engineering & Development"], location: "Bethesda, MD",
      },
      {
        id: "13743", title: "Sr. Content Strategist", employerName: "Bixal",
        applyUrl: "https://careers.bixal.com/jobs/732787-sr-content-strategist",
        practices: ["Content & Communications"], location: "Unknown",
      },
    ]);
  });

  it("maps a job with its practice as the description and its DSCovery page as the source link", () => {
    expect(mapDscoveryListing(analyticaJob!)).toEqual({
      source: "dscovery",
      sourceJobId: "13534",
      title: "Senior Cloud & Data Platform Architect",
      employerName: "Analytica",
      location: "Bethesda, MD",
      salary: null,
      description: "Practice: Engineering & Development",
      applyUrl: "https://analyticallc.applytojob.com/apply/VFbMwfkqm0/Senior-Cloud-Data-Platform-Architect",
      sourceUrl: "https://dscovery.fly.dev/jobs/13534/",
      postedAt: null,
      deadline: null,
    });
  });

  it("maps an Unknown location and absent fields to null", () => {
    expect(mapDscoveryListing(bixalJob!).location).toBeNull();
    const bare = readHomePageJobs('<table><caption></caption><tr id="job-1"><td></td><td class="job-link"><a>Analyst</a></td></tr></table>');
    expect(bare.map(mapDscoveryListing)).toMatchObject([
      { title: "Analyst", employerName: null, applyUrl: null, location: null, description: "" },
    ]);
  });

  it("rejects a listing without a numeric id or a title", () => {
    expect(() => mapDscoveryListing({ ...analyticaJob!, id: "" })).toThrow("Invalid DSCovery listing");
    expect(() => mapDscoveryListing({ ...analyticaJob!, title: "" })).toThrow("Invalid DSCovery listing");
  });

  it("fetches the home page once and reports its failure", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(homePage));
    expect((await fetchDscoveryJobs(fetcher)).map(job => job.id)).toEqual(["13534", "13743"]);
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(["https://dscovery.fly.dev/"]);
    await expect(fetchDscoveryJobs(async () => new Response("", { status: 503 })))
      .rejects.toThrow("DSCovery home page: HTTP 503");
    expect(await fetchDscoveryJobs(async () => new Response("<html></html>"))).toEqual([]);
  });
});
