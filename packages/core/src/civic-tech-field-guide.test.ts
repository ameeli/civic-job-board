import { describe, expect, it, vi } from "vitest";
import feed from "./fixtures/civic-tech-field-guide-feed.json";
import { fetchCtfgFeedItems, mapCtfgListing } from "./civic-tech-field-guide";

// Live feed.json?kind=jobs capture, 2026-11-03: two items, trimmed to the fields the parser reads.
const [fullItem, bareItem] = feed.items;

describe("Civic Tech Field Guide", () => {
  it("maps the feed's job fields as the board gives them", () => {
    expect(mapCtfgListing(fullItem!)).toEqual({
      source: "civic-tech-field-guide",
      sourceJobId: "recoyBXtsX92N1b8k",
      title: "Associate Director, Strategy",
      employerName: "Wellcome Trust",
      location: "Hybrid (London, UK)",
      salary: "£116,320 - £145,400",
      description: [
        "We exist to improve health for everyone by helping great ideas to thrive. Wellcome is an independent global charitable foundation.",
        "Organization type: Non-profit / charity / foundation",
        "Categories: Foundation initiatives",
        "Issues: health",
      ].join("\n"),
      applyUrl: "https://wellcome.wd3.myworkdayjobs.com/en-US/Wellcome/job/Associate-Director--Strategy_R-003525",
      sourceUrl: "https://app.civictech.guide/job?recordId=recbyxPQel9RAHEV3",
      postedAt: new Date("2026-10-16T00:00:00Z"),
      deadline: "2026-10-27",
    });
  });

  it("maps absent optional fields to null", () => {
    expect(mapCtfgListing(bareItem!)).toMatchObject({
      title: "Vice President, Head of Trust & Safety", employerName: "Lego Digital Play",
      salary: null, deadline: null, description: "Categories: Trust & Safety, Child safety",
    });
    expect(mapCtfgListing({ ...bareItem!, link: null, added: null, data: { role: "Analyst" } })).toMatchObject({
      employerName: null, location: null, applyUrl: null, postedAt: null, description: "",
    });
    expect(mapCtfgListing({ ...bareItem!, added: "Oct 16" }).postedAt).toBeNull();
  });

  it.each([
    { ...bareItem!, guid: "civictech.guide:events:rec1" },
    { ...bareItem!, guid: "civictech.guide:jobs:" },
    { ...bareItem!, data: { organization: "No role" } },
    { ...bareItem!, permalink: null },
  ])("rejects an item without a job id, role, or Field Guide page: %j", item => {
    expect(() => mapCtfgListing(item)).toThrow("Invalid Civic Tech Field Guide listing");
  });

  it("fetches the newest 100 jobs from the JSON feed", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(feed));
    expect(await fetchCtfgFeedItems(fetcher)).toEqual(feed.items);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://civictech.guide/api/v1/feed.json?kind=jobs&limit=100");
  });

  it("reports feed failures and malformed responses", async () => {
    await expect(fetchCtfgFeedItems(vi.fn().mockResolvedValue(new Response("", { status: 429 }))))
      .rejects.toThrow("Civic Tech Field Guide feed: HTTP 429");
    await expect(fetchCtfgFeedItems(vi.fn().mockResolvedValue(Response.json([])))).rejects.toThrow("items array");
    await expect(fetchCtfgFeedItems(vi.fn().mockResolvedValue(Response.json(null)))).rejects.toThrow("items array");
    expect(await fetchCtfgFeedItems(vi.fn().mockResolvedValue(Response.json({ items: [] })))).toEqual([]);
  });
});
