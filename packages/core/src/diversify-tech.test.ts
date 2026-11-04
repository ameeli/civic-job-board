import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  fetchDiversifyJobPages, mapDiversifyListing, readJobPageUrls, readJobRecord, type DiversifyJob,
} from "./diversify-tech";

// Live captures, 2026-11-04, trimmed to what the parser reads: the jobs sitemap
// cut to two jobs' page links, and one job page cut to its job record's fields.
const sitemap = readFileSync(new URL("./fixtures/diversify-tech-sitemap-jobs.xml", import.meta.url), "utf8");
const jobPage = readFileSync(new URL("./fixtures/diversify-tech-job-page.html", import.meta.url), "utf8");
const job = readJobRecord(jobPage);
const sourceUrl = "https://jobs.diversifytech.com/job/2551571-web-developer-colorado-public-radio";
const listing = (fields: Partial<DiversifyJob>) => mapDiversifyListing({ sourceUrl, job: { ...job, ...fields } });
/** A fake board serving the sitemap and job page, except `failingUrl`, which answers `status`. */
const fakeBoard = (failingUrl = "", status = 200) => vi.fn(async (input: string | URL | Request) => {
  const url = String(input);
  if (url === failingUrl) return new Response("", { status });
  return new Response(url.endsWith("sitemap-jobs.xml") ? sitemap : jobPage);
});

describe("Diversify Tech", () => {
  it("reads the job page URLs from the sitemap", () => {
    expect(readJobPageUrls(sitemap)).toEqual([
      sourceUrl, "https://jobs.diversifytech.com/job/2580758-head-of-technology-sanctuary-computer",
    ]);
    expect(readJobPageUrls(sitemap.replace("/job/2580758", "/api/jobs/2580758"))).toEqual([sourceUrl]);
  });

  it("maps the job page's record with salary and location as the board shows them", () => {
    expect(mapDiversifyListing({ sourceUrl, job })).toEqual({
      source: "diversify-tech",
      sourceJobId: "2551571",
      title: "Web Developer",
      employerName: "Colorado Public Radio",
      location: "Denver, CO, USA (Hybrid: Must be based in Denver by the time you start the job. Tuesdays, Wednesdays and Thursdays are in-office at a building in Centennial. Although, we will soon be moving to downtown Denver, so the schedule would be in-office there as of summer 2027.)",
      salary: "$76,286-101,641 (Annually)",
      description: expect.stringMatching(/^Colorado Public Radio \(CPR\) is seeking a Web Developer\.\nAbout the Position:\nThe Web Developer plays/),
      applyUrl: "https://secure.entertimeonline.com/ta/mopbc0031.careers?applytojob=889327873&full_apply=&jobid=889327873",
      sourceUrl,
      postedAt: new Date("2026-09-25T15:42:59.183Z"),
      deadline: "10/2/2026",
    });
  });

  it.each([
    [{ remote_only: true, remote_required_location: null }, "Anywhere (Remote only)"],
    [{ remote_only: true, remote_required_location: "United States" }, "United States (Remote only)"],
    [{ remote_required_location: null }, "Denver, CO, USA (Hybrid)"],
    [{ is_remote: false, remote_required_location: null }, "Denver, CO, USA"],
    [{ is_remote: false, location_name: null }, null],
  ])("shows the location the board shows for %j", (fields, location) => {
    expect(listing(fields).location).toBe(location);
  });

  it.each([
    [{ salary_min: "228800.00", salary_max: "308800.00", salary_timeframe: "monthly" }, "$228,800-308,800 (Monthly)"],
    [{ salary_min: "21.63", salary_max: "25.96", salary_timeframe: "hourly" }, "$21.63-25.96 (Hourly)"],
    [{ salary_max: null }, "$76,286+ (Annually)"],
    [{ salary_min: null, salary_currency: "EUR", salary_timeframe: null }, "EUR 101,641"],
    [{ salary_min: null, salary_max: null }, null],
  ])("writes the salary the board shows for %j", (fields, salary) => {
    expect(listing(fields).salary).toBe(salary);
  });

  it("maps absent optional fields to null", () => {
    expect(listing({
      company: null, apply_url: null, description_html: null, published_at: null, custom_fields: null,
    })).toMatchObject({ employerName: null, applyUrl: null, description: "", postedAt: null, deadline: null });
    expect(listing({ custom_fields: { "application-deadline": { value: " " } } }).deadline).toBeNull();
  });

  it.each([{ id: Number.NaN }, { title: "" }])("rejects a record without an id or title: %j", fields => {
    expect(() => listing(fields)).toThrow("Invalid Diversify Tech listing");
  });

  it("rejects a page without a job record", () => {
    expect(() => readJobRecord("<html></html>")).toThrow("Diversify Tech job page has no job record");
  });

  it("fetches each job page from the sitemap a second apart", async () => {
    const fetcher = fakeBoard();
    const sleep = vi.fn(async () => {});
    const pages = await fetchDiversifyJobPages(fetcher, sleep);
    expect(pages.map(page => page.sourceUrl)).toEqual(readJobPageUrls(sitemap));
    expect(pages[0]!.job).toEqual(job);
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "https://jobs.diversifytech.com/sitemap-jobs.xml", ...readJobPageUrls(sitemap),
    ]);
    expect(sleep.mock.calls).toEqual([[1_000], [1_000]]);
  });

  it("reports sitemap and job page failures", async () => {
    const sleep = async () => {};
    await expect(fetchDiversifyJobPages(fakeBoard("https://jobs.diversifytech.com/sitemap-jobs.xml", 503), sleep))
      .rejects.toThrow("Diversify Tech sitemap: HTTP 503");
    await expect(fetchDiversifyJobPages(fakeBoard(sourceUrl, 404), sleep)).rejects.toThrow("Diversify Tech job page: HTTP 404");
    expect(await fetchDiversifyJobPages(async () => new Response("<urlset></urlset>"), sleep)).toEqual([]);
  });
});
