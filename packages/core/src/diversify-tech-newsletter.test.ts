import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  fetchNewsletterJobs, mapNewsletterListing, readAroundTheWebJobs, readRecentIssues,
} from "./diversify-tech-newsletter";

// Live capture, 2026-11-11: the feed cut to issues #412 (no outside jobs), #411, and #409,
// each cut to a few lines of its JOBS section and, for #412, of its EVENTS section.
const feed = readFileSync(new URL("./fixtures/diversify-tech-newsletter-feed.xml", import.meta.url), "utf8");
const issue411 = "https://newsletter.diversifytech.com/p/diversify-tech-411";
/** A day after #412, so #411 is in the two-week window and #409 is not. */
const now = new Date("2026-11-12T08:00:00Z");
const fakeFeed = (body = feed, status = 200) => vi.fn(async () => new Response(body, { status }));

describe("Diversify Tech newsletter", () => {
  it("reads the issues of the last two weeks", () => {
    expect(readRecentIssues(feed, now).map(issue => [issue.url, issue.publishedAt])).toEqual([
      ["https://newsletter.diversifytech.com/p/diversify-tech-412", new Date("2026-11-11T01:00:00Z")],
      [issue411, new Date("2026-11-04T01:00:00Z")],
    ]);
  });

  it("reads only the JOBS section's \"From around the web\" lines", () => {
    const [issue412, issue411Read] = readRecentIssues(feed, now);
    expect(readAroundTheWebJobs(issue412!)).toEqual([]);
    expect(readAroundTheWebJobs(issue411Read!).map(job => job.title)).toEqual(["Data Scientist: Product", "Frontend Engineer II"]);
  });

  it("maps a line's employer and location, keyed by its link without tracking parameters", async () => {
    const [thatch, openly] = (await fetchNewsletterJobs(fakeFeed(), now)).map(mapNewsletterListing);
    expect(thatch).toEqual({
      source: "diversify-tech-newsletter",
      sourceJobId: "https://thatch.com/jobs/5461158008?gh_jid=5461158008",
      title: "Data Scientist: Product",
      employerName: "Thatch",
      location: "Austin, Texas, United States; New York, New York, United States; Remote (US); San Francisco, California, United States",
      salary: null,
      description: "",
      applyUrl: "https://thatch.com/jobs/5461158008?gh_jid=5461158008",
      sourceUrl: issue411,
      postedAt: new Date("2026-11-04T01:00:00Z"),
      deadline: null,
    });
    expect(openly).toMatchObject({ title: "Frontend Engineer II", employerName: "Openly", location: "Remote - US" });
  });

  it("keeps a job listed by two issues once, from the newer issue", async () => {
    // #409, moved into the two-week window, lists Openly's job too.
    const repeated = feed.replace("Wed, 21 Oct 2026 00:00", "Tue, 03 Nov 2026 00:00")
      .replace(/https:\/\/jobs\.dayforcehcm\.com[^"]*/, "https://jobs.ashbyhq.com/openly/49e7e0e1-23b9-4d4f-9505-3d6646f384a7");
    const jobs = await fetchNewsletterJobs(fakeFeed(repeated), now);
    expect(jobs.map(job => [job.title, job.issueUrl])).toEqual([
      ["Data Scientist: Product", issue411], ["Frontend Engineer II", issue411],
    ]);
  });

  it("requests the feed once, uncached, and names it in an HTTP error", async () => {
    const fetcher = fakeFeed();
    await fetchNewsletterJobs(fetcher, now);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "https://rss.beehiiv.com/feeds/C62C2GAygE.xml", expect.objectContaining({ cache: "no-store" }),
    );
    await expect(fetchNewsletterJobs(fakeFeed("", 503), now)).rejects.toThrow("Diversify Tech newsletter feed: HTTP 503");
  });
});
