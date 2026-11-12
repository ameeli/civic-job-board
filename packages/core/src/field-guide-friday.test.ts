import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { fetchFgfJobs, mapFgfListing, readFeedJobs } from "./field-guide-friday";

// Live archive feed capture, 2026-11-11: two issues, each trimmed to its job heading and two job paragraphs.
const feed = readFileSync(new URL("./fixtures/field-guide-friday-feed.xml", import.meta.url), "utf8");
const FEED_URL = "https://us19.campaign-archive.com/feed?u=cdb853c4847acff0d0a09460d&id=ca5a70438b";
const OCT_ISSUE = "https://us19.campaign-archive.com/?u=cdb853c4847acff0d0a09460d&id=7118ac4851";
const SEP_ISSUE = "https://us19.campaign-archive.com/?u=cdb853c4847acff0d0a09460d&id=e60f696a81";

describe("Field Guide Friday", () => {
  it("maps each issue's job paragraphs, oldest issue first, with the line under each title split apart", () => {
    expect(readFeedJobs(feed).map(mapFgfListing)).toEqual([
      {
        source: "field-guide-friday",
        sourceJobId: "https://data.org/jobs/director-measurement-impact Director, Measurement & Impact",
        title: "Director, Measurement & Impact",
        employerName: "Caribou Digital",
        location: "Remote (Global)",
        salary: null,
        description: "",
        applyUrl: "https://data.org/jobs/director-measurement-impact",
        sourceUrl: SEP_ISSUE,
        postedAt: new Date("2026-09-11T14:47:04Z"),
        deadline: "09-25-2026",
      },
      expect.objectContaining({
        title: "Presidential Postdoctoral Fellow/Assistant Professor - Privacy and Technology",
        employerName: "University of Michigan", location: null, salary: null, deadline: "11-01-2026",
      }),
      expect.objectContaining({
        title: "Design Researcher", employerName: "Superbloom (our fiscal sponsor!!)",
        location: "Hybrid (East Coast, US)", salary: "$60,000 - $80,000", deadline: null,
        sourceUrl: OCT_ISSUE, postedAt: new Date("2026-10-09T15:08:47Z"),
      }),
      expect.objectContaining({
        title: "Program Officer, AI Model Safety", employerName: "OpenAI Foundation",
        location: "Hybrid (San Francisco, CA)", salary: "$220,000 - $300,000", deadline: "10-30-2026",
      }),
    ]);
  });

  it("keeps a job a later issue lists again from the issue that first listed it", () => {
    const relisted = feed.replace("https://superbloom.design/community/opportunities/f2026-design-researcher/", "https://data.org/jobs/director-measurement-impact")
      .replace(">Design Researcher<", ">Director, Measurement &amp; Impact<");
    const jobs = readFeedJobs(relisted);
    expect(jobs).toHaveLength(3);
    expect(jobs[0]).toMatchObject({ title: "Director, Measurement & Impact", issueUrl: SEP_ISSUE });
  });

  it("rejects a job paragraph without a linked title", () => {
    const [job] = readFeedJobs(feed);
    expect(() => mapFgfListing({ ...job!, title: "" })).toThrow("Invalid Field Guide Friday listing");
    expect(() => mapFgfListing({ ...job!, applyUrl: "" })).toThrow("Invalid Field Guide Friday listing");
  });

  it("keeps jobs with unreadable issue dates and maps their posted dates to null", () => {
    const jobs = readFeedJobs(feed.replace("Fri, 09 Oct 2026 15:08:47 +0000", "soon"));
    expect(jobs).toHaveLength(4);
    expect(jobs[2]!.issueSentAt).toBeInstanceOf(Date);
    expect(jobs.map(mapFgfListing).map(job => job.postedAt)).toEqual([
      new Date("2026-09-11T14:47:04Z"), new Date("2026-09-11T14:47:04Z"), null, null,
    ]);
  });

  it("fetches the newsletter's archive feed and reports feed failures", async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(feed));
    expect(await fetchFgfJobs(fetcher)).toMatchObject([
      { title: "Director, Measurement & Impact" },
      { title: "Presidential Postdoctoral Fellow/Assistant Professor - Privacy and Technology" },
      { title: "Design Researcher" }, { title: "Program Officer, AI Model Safety" },
    ]);
    expect(fetcher.mock.calls[0]?.[0]).toBe(FEED_URL);
    await expect(fetchFgfJobs(vi.fn().mockResolvedValue(new Response("", { status: 503 }))))
      .rejects.toThrow("Field Guide Friday feed: HTTP 503");
    expect(await fetchFgfJobs(vi.fn().mockResolvedValue(new Response("<rss></rss>")))).toEqual([]);
  });
});
