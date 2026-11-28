import { describe, expect, it, vi } from "vitest";
import record from "./fixtures/gov-listing.json";
import { fetchGovRecords, mapGovListing } from "./tech-jobs-for-gov";

// Live API capture, 2026-11-23: unrelated fields removed, description kept to its first paragraph.
describe("Tech Jobs for Gov", () => {
  it("maps board text without salary or location normalization", () => {
    const job = mapGovListing(record);
    expect(job).toMatchObject({
      source: "tech-jobs-for-gov", sourceJobId: "4798",
      title: "Manager of Web and Digital Strategy",
      employerName: "City of Tuscaloosa",
      salary: "108461.18", location: "Tuscaloosa, AL",
      applyUrl: "https://www.governmentjobs.com/careers/tuscaloosa/jobs/5540003",
      sourceUrl: record.link, deadline: null,
      postedAt: new Date("2026-11-20T21:24:02Z"),
    });
    expect(job.description).toContain("City of Tuscaloosa's home page");
    expect(job.description).not.toContain("<p>");
  });

  it("decodes HTML entities in API application links", () => {
    const job = mapGovListing({ ...record, meta: {
      ...record.meta, _application: "https://example.org/?UniqueId=101&amp;CommunityJobs=False&amp;JobID=Data-Analyst-8",
    } });
    expect(job.applyUrl).toBe("https://example.org/?UniqueId=101&CommunityJobs=False&JobID=Data-Analyst-8");
    expect(new URL(job.applyUrl!).searchParams.get("JobID")).toBe("Data-Analyst-8");
  });

  it("maps absent or empty API meta fields to null", () => {
    expect(mapGovListing({ ...record, meta: {} })).toMatchObject({
      employerName: null, location: null, salary: null, applyUrl: null,
    });
    expect(mapGovListing({ ...record, meta: {
      _company_name: "", _job_location: "", _job_salary: "", _application: "",
    } })).toMatchObject({ employerName: null, location: null, salary: null, applyUrl: null });
  });

  it("handles absent optional data and decodes rendered HTML", () => {
    expect(mapGovListing({ id: 1, link: record.link, title: { rendered: "Data &amp; Design" },
      content: { rendered: "<p>A</p><p>B &lt; C</p>" } })).toMatchObject({
      title: "Data & Design", description: "A\nB < C", employerName: null,
      salary: null, location: null, deadline: null, postedAt: null,
    });
    expect(() => mapGovListing({ ...record, id: NaN })).toThrow("Invalid");
  });

  it("fetches every API page", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json([record], {
      headers: { "x-wp-totalpages": "2" },
    })).mockResolvedValueOnce(Response.json([{ ...record, id: 2 }]));
    expect((await fetchGovRecords(fetcher)).map(job => job.id)).toEqual([4798, 2]);
    expect(fetcher.mock.calls[1]?.[0]).toContain("page=2");
  });

  it("reports API failures and malformed responses", async () => {
    await expect(fetchGovRecords(vi.fn().mockResolvedValue(new Response("", { status: 503 })))).rejects.toThrow("HTTP 503");
    await expect(fetchGovRecords(vi.fn().mockResolvedValue(Response.json({})))).rejects.toThrow("listings array");
    expect(await fetchGovRecords(vi.fn().mockResolvedValue(Response.json([])))).toEqual([]);
  });
});
