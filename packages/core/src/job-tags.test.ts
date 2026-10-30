import { describe, expect, it } from "vitest";
import {
  buildTaggingRequest, describeJobTags, readTaggingAnswer, ROLE_TAGS, SECTOR_TAGS, SENIORITY_LEVELS, taggingRetryWaitSeconds,
} from "./job-tags";

const geminiResponse = (text: string) => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] });
const answer = (fields: object) => geminiResponse(JSON.stringify(fields));
const allUnknown = { tags: { roleTags: ["unknown"], sectorTags: ["unknown"], seniority: "unknown", summary: null }, defaultedToUnknown: true };

describe("buildTaggingRequest", () => {
  it("sends title, employer, and a trimmed description with every allowed tag in the schema", () => {
    const request = buildTaggingRequest({ title: "Data Engineer", employerName: null, description: "x".repeat(5_000) });
    const listing = request.contents[0]!.parts[0]!.text;
    expect(listing).toContain("Title: Data Engineer\nEmployer: Unknown\n");
    expect(listing.length).toBeLessThan(4_100);
    const { properties } = request.generationConfig.responseJsonSchema;
    expect(properties.roleTags.items.enum).toEqual(Object.keys(ROLE_TAGS));
    expect(properties.roleTags).toMatchObject({ minItems: 1, maxItems: 3 });
    expect(properties.sectorTags.items.enum).toEqual(Object.keys(SECTOR_TAGS));
    expect(properties.seniority.enum).toEqual(Object.keys(SENIORITY_LEVELS));
    expect(Object.keys(ROLE_TAGS)).toHaveLength(13);
    expect(Object.keys(SECTOR_TAGS)).toHaveLength(10);
  });
});

describe("readTaggingAnswer", () => {
  it("keeps a valid answer", () => {
    expect(readTaggingAnswer(answer({
      roleTags: ["data-analysis", "data-science-ai"], sectorTags: ["health-human-services"],
      seniority: "senior", summary: "  Analyzes public health data.  ",
    }))).toEqual({ tags: {
      roleTags: ["data-analysis", "data-science-ai"], sectorTags: ["health-human-services"],
      seniority: "senior", summary: "Analyzes public health data.",
    }, defaultedToUnknown: false });
  });

  it("drops off-list, duplicate, and extra tags and keeps the valid ones", () => {
    expect(readTaggingAnswer(answer({
      roleTags: ["made-up", "security", "security", "unknown", "data-analysis", "design-research", "product-management"],
      sectorTags: ["education", 7], seniority: "mid", summary: "",
    }))).toEqual({ tags: {
      roleTags: ["security", "data-analysis", "design-research"], sectorTags: ["education"],
      seniority: "mid", summary: null,
    }, defaultedToUnknown: false });
  });

  it("does not count Gemini's own unknown choice as defaulted", () => {
    expect(readTaggingAnswer(answer({ roleTags: ["unknown"], sectorTags: ["unknown"], seniority: "unknown", summary: "A job." })))
      .toEqual({ tags: { roleTags: ["unknown"], sectorTags: ["unknown"], seniority: "unknown", summary: "A job." }, defaultedToUnknown: false });
  });

  it("defaults to unknown when a field has nothing valid", () => {
    expect(readTaggingAnswer(answer({ roleTags: ["made-up"], sectorTags: ["education"], seniority: "mid", summary: "A job." })))
      .toMatchObject({ tags: { roleTags: ["unknown"] }, defaultedToUnknown: true });
    expect(readTaggingAnswer(answer({ roleTags: ["security"], sectorTags: "education", seniority: "mid" })))
      .toMatchObject({ tags: { sectorTags: ["unknown"], summary: null }, defaultedToUnknown: true });
    expect(readTaggingAnswer(answer({ roleTags: ["security"], sectorTags: ["education"], seniority: "intern" })))
      .toMatchObject({ tags: { seniority: "unknown" }, defaultedToUnknown: true });
  });

  it("tags malformed, truncated, blocked, and empty answers as all unknown", () => {
    expect(readTaggingAnswer(geminiResponse('{"roleTags": ["secu'))).toEqual(allUnknown);
    expect(readTaggingAnswer(geminiResponse("null"))).toEqual(allUnknown);
    expect(readTaggingAnswer({ promptFeedback: { blockReason: "SAFETY" } })).toEqual(allUnknown);
    expect(readTaggingAnswer({ candidates: [{ finishReason: "SAFETY" }] })).toEqual(allUnknown);
    expect(readTaggingAnswer(null)).toEqual(allUnknown);
  });
});

it("describes tags with their labels", () => {
  expect(describeJobTags({ roleTags: ["data-science-ai", "unknown"], sectorTags: ["finance-revenue"], seniority: "leadership" }))
    .toBe("Roles: Data science & AI, Unknown · Sectors: Finance & revenue · Seniority: Leadership");
});

describe("taggingRetryWaitSeconds", () => {
  const now = new Date("2026-10-30T12:00:00Z");

  it("waits 30 then 60 seconds without Retry-After", () => {
    expect(taggingRetryWaitSeconds(1, null, now)).toBe(30);
    expect(taggingRetryWaitSeconds(2, "", now)).toBe(60);
  });

  it("honors Retry-After seconds or dates, bounded to 0-60 seconds", () => {
    expect(taggingRetryWaitSeconds(1, "12", now)).toBe(12);
    expect(taggingRetryWaitSeconds(1, "600", now)).toBe(60);
    expect(taggingRetryWaitSeconds(2, "Fri, 30 Oct 2026 12:00:20 GMT", now)).toBe(20);
    expect(taggingRetryWaitSeconds(1, "Fri, 30 Oct 2026 11:00:00 GMT", now)).toBe(0);
    expect(taggingRetryWaitSeconds(2, "soon", now)).toBe(60);
  });
});
