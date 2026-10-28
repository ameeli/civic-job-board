import { describe, expect, it, vi } from "vitest";
import record from "./fixtures/gov-listing.json";
import { fetchGovRecords, govPageApplyLink, planGovJob } from "./tech-jobs-for-gov";

// Live API capture, 2026-10-28: unrelated fields removed, description kept to its first paragraph.
describe("Tech Jobs for Gov", () => {
  it("maps board text without salary or location normalization", () => {
    const plan = planGovJob(record);
    expect(plan).toMatchObject({ isNew: true, needsPage: false, job: {
      source: "tech-jobs-for-gov", sourceJobId: "4296",
      title: "Senior DevOps Engineer",
      employerName: "State of Louisiana, Division of Administration-Office of Technology Services",
      salary: "126252", location: "Baton Rouge, LA",
      applyUrl: "https://www.governmentjobs.com/careers/louisiana/jobs/5526277",
      sourceUrl: record.link, deadline: "2026-11-06",
      postedAt: new Date("2026-10-27T23:31:22Z"),
    } });
    expect(plan.job.description).toContain("Architecture, Standards & Platform");
    expect(plan.job.description).not.toContain("<p>");
  });

  it("requests a page only for a new job without an API apply link", () => {
    const noLink = { ...record, meta: {} };
    expect(planGovJob(noLink).needsPage).toBe(true);
    expect(planGovJob(noLink, { applyUrl: "https://example.org/apply" })).toMatchObject({
      isNew: false, needsPage: false, job: { applyUrl: "https://example.org/apply" },
    });
    expect(planGovJob(noLink, { applyUrl: null }).needsPage).toBe(false);
  });

  it("handles absent optional data and decodes rendered HTML", () => {
    expect(planGovJob({ id: 1, link: record.link, title: { rendered: "Data &amp; Design" },
      content: { rendered: "<p>A</p><p>B &lt; C</p>" } }).job).toMatchObject({
      title: "Data & Design", description: "A\nB < C", employerName: null,
      salary: null, location: null, deadline: null, postedAt: null,
    });
    expect(() => planGovJob({ ...record, id: NaN })).toThrow("Invalid");
  });

  it("reads the live page's apply button regardless of attribute order", () => {
    expect(govPageApplyLink('<a href="https://example.org/?a=1&amp;b=2" class="cws-apply-button button">View Original Posting</a>'))
      .toBe("https://example.org/?a=1&b=2");
    expect(govPageApplyLink('<a class="application_button" href="https://example.org">Apply</a>')).toBe("https://example.org");
    expect(govPageApplyLink("<p>No apply link</p>")).toBeNull();
  });

  it("fetches every API page", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json([record], {
      headers: { "x-wp-totalpages": "2" },
    })).mockResolvedValueOnce(Response.json([{ ...record, id: 2 }]));
    expect((await fetchGovRecords(fetcher)).map(job => job.id)).toEqual([4296, 2]);
    expect(fetcher.mock.calls[1]?.[0]).toContain("page=2");
  });

  it("reports API failures and malformed responses", async () => {
    await expect(fetchGovRecords(vi.fn().mockResolvedValue(new Response("", { status: 503 })))).rejects.toThrow("HTTP 503");
    await expect(fetchGovRecords(vi.fn().mockResolvedValue(Response.json({})))).rejects.toThrow("listings array");
    expect(await fetchGovRecords(vi.fn().mockResolvedValue(Response.json([])))).toEqual([]);
  });
});
