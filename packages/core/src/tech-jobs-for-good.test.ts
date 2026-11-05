import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  fetchTjfgJobPages, mapTjfgListing, readFreeJobIds, readJobListPageCount, readJobPage, type TjfgJob,
} from "./tech-jobs-for-good";

// Live captures, 2026-11-04: the free job list's first page trimmed to two jobs
// and its page links, and one job page trimmed to what the parser reads.
const jobList = readFileSync(new URL("./fixtures/tech-jobs-for-good-jobs.html", import.meta.url), "utf8");
const jobPage = readFileSync(new URL("./fixtures/tech-jobs-for-good-job-page.html", import.meta.url), "utf8");
const jobPageWithDeadline = readFileSync(new URL("./fixtures/tech-jobs-for-good-job-page-deadline.html", import.meta.url), "utf8");
const job = readJobPage(jobPage);
const listing = (fields: Partial<TjfgJob>) => mapTjfgListing({ id: "37445", job: { ...job, ...fields } });
/** A fake board serving the job list's three pages and any job page, except `failingUrl`, which answers `status`. */
const fakeBoard = (failingUrl = "", status = 200) => vi.fn(async (input: string | URL | Request) => {
  const url = String(input);
  if (url === failingUrl) return new Response("", { status });
  const listPage = /\/jobs\/(?:\?page=(\d))?$/.exec(url);
  if (!listPage) return new Response(url.endsWith("/37392/") ? jobPageWithDeadline : jobPage);
  // Page 3 repeats a job from page 2, as a newly posted job pushing the list down would.
  const [first, second] = { 1: ["37445", "37454"], 2: ["37444", "37392"], 3: ["37392", "37413"] }[listPage[1] ?? "1"]!;
  return new Response(jobList.replace("/jobs/37445/", `/jobs/${first}/`).replace("/jobs/37454/", `/jobs/${second}/`));
});

describe("Tech Jobs for Good", () => {
  it("reads the job ids and page count from a page of the free job list", () => {
    expect(readFreeJobIds(jobList)).toEqual(["37445", "37454"]);
    expect(readJobListPageCount(jobList)).toBe(3);
    expect(readJobListPageCount("<ul class=\"pagination\"><button class=\"ui button active\">1</button></ul>")).toBe(1);
  });

  it("maps a job page with the board's location and salary text and the Apply button's link", () => {
    expect(mapTjfgListing({ id: "37445", job })).toEqual({
      source: "tech-jobs-for-good",
      sourceJobId: "37445",
      title: "Senior Full Stack Web Engineer",
      employerName: "ROI Solutions, Inc",
      location: "Medford, MA / Boston, MA / Remote (Select US States)",
      salary: "$105,000 - $120,000 Per Year",
      description: expect.stringMatching(/^About the Role\nWe are looking for a Senior Full Stack Engineer[^]*\nResponsibilities\nDevelop high-quality product features using modern web technologies and engineering best practices\.$/),
      applyUrl: "https://roisolutions.bamboohr.com/careers/97?source=aWQ9NTU%3D",
      sourceUrl: "https://techjobsforgood.com/jobs/37445/",
      postedAt: new Date("2026-11-03T00:00:00Z"),
      deadline: null,
    });
  });

  it("keeps an email Apply link and maps absent fields to null", () => {
    const mailto = jobPage.replace(/window\.open\('[^']*'/, "window.open('mailto:careers@example.org'");
    expect(readJobPage(mailto).applyUrl).toBe("mailto:careers@example.org");
    const bare = readJobPage("<script type=\"application/ld+json\">{\"title\": \"Analyst\"}</script>");
    expect(bare).toEqual({ posting: { title: "Analyst" }, location: null, salary: null, deadline: null, applyUrl: null });
    expect(listing(bare)).toMatchObject({ employerName: null, description: "", postedAt: null, applyUrl: null });
  });

  it("keeps the displayed employer deadline as text", () => {
    const job = readJobPage(jobPageWithDeadline);
    expect(job.deadline).toBe("November 16, 2026");
    expect(mapTjfgListing({ id: "37392", job })).toMatchObject({
      title: "Database Specialist", employerName: "Piedmont Environmental Council",
      deadline: "November 16, 2026",
    });
  });

  it("ignores board expiry and description deadlines when the displayed field is absent or empty", () => {
    const posting = JSON.stringify({
      title: "Analyst", validThrough: "2026-12-31",
      description: "<span>Application deadline: November 16, 2026</span>",
    });
    const page = `<script type="application/ld+json">${posting}</script>
      <div itemprop="description"><span>Application deadline: November 16, 2026</span></div>
      <span itemprop="description">Application deadline: November 16, 2026</span>`;
    for (const field of ["", "<span>Application deadline: \n </span>"]) {
      const job = readJobPage(page + field);
      expect(job.deadline).toBeNull();
      expect(mapTjfgListing({ id: "37392", job }).deadline).toBeNull();
    }
  });

  it("rejects a page without JobPosting data and a listing without an id or title", () => {
    expect(() => readJobPage("<html></html>")).toThrow("Tech Jobs for Good job page has no JobPosting data");
    expect(() => mapTjfgListing({ id: "", job })).toThrow("Invalid Tech Jobs for Good listing");
    expect(() => listing({ posting: { ...job.posting, title: "" } })).toThrow("Invalid Tech Jobs for Good listing");
  });

  it("fetches each list page, then each listed job's page once, a second apart", async () => {
    const fetcher = fakeBoard();
    const sleep = vi.fn(async () => {});
    const pages = await fetchTjfgJobPages(fetcher, sleep);
    expect(pages.map(page => page.id)).toEqual(["37445", "37454", "37444", "37392", "37413"]);
    expect(pages[0]!.job).toEqual(job);
    expect(mapTjfgListing(pages.find(page => page.id === "37392")!).deadline).toBe("November 16, 2026");
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "https://techjobsforgood.com/jobs/", "https://techjobsforgood.com/jobs/?page=2", "https://techjobsforgood.com/jobs/?page=3",
      ...pages.map(page => `https://techjobsforgood.com/jobs/${page.id}/`),
    ]);
    expect(sleep.mock.calls).toEqual(Array(7).fill([1_000]));
  });

  it("reports job list and job page failures", async () => {
    const sleep = async () => {};
    await expect(fetchTjfgJobPages(fakeBoard("https://techjobsforgood.com/jobs/?page=2", 503), sleep))
      .rejects.toThrow("Tech Jobs for Good job list: HTTP 503");
    await expect(fetchTjfgJobPages(fakeBoard("https://techjobsforgood.com/jobs/37454/", 404), sleep))
      .rejects.toThrow("Tech Jobs for Good job page: HTTP 404");
    expect(await fetchTjfgJobPages(async () => new Response("<html></html>"), sleep)).toEqual([]);
  });
});
