import { describe, expect, it, vi } from "vitest";
import record from "./fixtures/gov-listing.json";
import { fetchGovRecords, mapGovJob } from "./tech-jobs-for-gov";

// Live API capture, 2026-10-28: unrelated fields removed, description kept to its first paragraph.
describe("Tech Jobs for Gov", () => {
  it("maps board text without salary or location normalization", () => {
    const job = mapGovJob(record);
    expect(job).toMatchObject({
      source: "tech-jobs-for-gov", sourceJobId: "4296",
      title: "Senior DevOps Engineer",
      employerName: "State of Louisiana, Division of Administration-Office of Technology Services",
      salary: "126252", location: "Baton Rouge, LA",
      applyUrl: "https://www.governmentjobs.com/careers/louisiana/jobs/5526277",
      sourceUrl: record.link, deadline: "2026-11-06",
      postedAt: new Date("2026-10-27T23:31:22Z"),
    });
    expect(job.description).toContain("Architecture, Standards & Platform");
    expect(job.description).not.toContain("<p>");
  });

  it("decodes HTML entities in API application links", () => {
    const job = mapGovJob({ ...record, meta: {
      _application: "https://example.org/?UniqueId=101&amp;CommunityJobs=False&amp;JobID=Data-Analyst-8",
    } });
    expect(job.applyUrl).toBe("https://example.org/?UniqueId=101&CommunityJobs=False&JobID=Data-Analyst-8");
    expect(new URL(job.applyUrl!).searchParams.get("JobID")).toBe("Data-Analyst-8");
  });

  it("maps absent or empty API application links to null", () => {
    expect(mapGovJob({ ...record, meta: {} }).applyUrl).toBeNull();
    expect(mapGovJob({ ...record, meta: { _application: "" } }).applyUrl).toBeNull();
  });

  it("handles absent optional data and decodes rendered HTML", () => {
    expect(mapGovJob({ id: 1, link: record.link, title: { rendered: "Data &amp; Design" },
      content: { rendered: "<p>A</p><p>B &lt; C</p>" } })).toMatchObject({
      title: "Data & Design", description: "A\nB < C", employerName: null,
      salary: null, location: null, deadline: null, postedAt: null,
    });
    expect(() => mapGovJob({ ...record, id: NaN })).toThrow("Invalid");
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
