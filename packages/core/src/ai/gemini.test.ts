import { describe, expect, it, vi } from "vitest";
import { DEFAULT_GEMINI_MODEL, GeminiError, createGeminiTagger, parseTaggings } from "./gemini";

const job = {
  id: "7",
  title: "Senior Software Engineer",
  orgName: "City of Phoenix",
  location: "Phoenix, AZ",
  description: "Build services for residents.",
  boardTags: ["Engineering & Cybersecurity"],
};

function interaction(output: unknown) {
  return JSON.stringify({
    status: "completed",
    steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(output) }] }],
  });
}

function fakeFetch(status: number, body: string) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    url: "",
    headers: { get: () => null },
    text: async () => body,
  }));
}

const goodOutput = {
  jobs: [
    {
      id: "7",
      job_function: "Software Engineering",
      job_function_confidence: 0.92,
      sectors: [
        { sector: "Government/Public sector", confidence: 0.95 },
        { sector: "Made up sector", confidence: 0.9 },
      ],
      seniority: "Senior",
      summary: "Builds digital services for Phoenix residents.",
      organization: "",
    },
  ],
};

describe("createGeminiTagger", () => {
  it("posts one structured-output interaction and parses the result", async () => {
    const fetch = fakeFetch(200, interaction(goodOutput));
    const tagger = createGeminiTagger({ apiKey: "test-key", fetch });

    const taggings = await tagger.tagJobs([job]);

    expect(taggings).toEqual([
      {
        id: "7",
        jobFunction: { tag: "Software Engineering", confidence: 0.92 },
        sectors: [{ tag: "Government/Public sector", confidence: 0.95 }],
        seniority: "Senior",
        summary: "Builds digital services for Phoenix residents.",
        organization: null,
      },
    ]);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(init.headers["x-goog-api-key"]).toBe("test-key");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: DEFAULT_GEMINI_MODEL, store: false });
    expect(body.response_format).toMatchObject({ type: "text", mime_type: "application/json" });
    expect(body.input).toContain("City of Phoenix");
  });

  it("reports a 429 as rate limited", async () => {
    const tagger = createGeminiTagger({ apiKey: "k", fetch: fakeFetch(429, '{"error":"quota"}') });

    const error = await tagger.tagJobs([job]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GeminiError);
    expect((error as GeminiError).rateLimited).toBe(true);
  });

  it("sends nothing for an empty batch", async () => {
    const fetch = fakeFetch(200, "");
    expect(await createGeminiTagger({ apiKey: "k", fetch }).tagJobs([])).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("parseTaggings", () => {
  it("drops jobs outside the batch or outside the taxonomy", () => {
    const text = JSON.stringify({
      jobs: [
        { ...goodOutput.jobs[0], id: "other" },
        { ...goodOutput.jobs[0], id: "7", job_function: "Astronaut" },
      ],
    });
    expect(parseTaggings(text, new Set(["7"]))).toEqual([]);
  });

  it("keeps a stated organization", () => {
    const text = JSON.stringify({ jobs: [{ ...goodOutput.jobs[0], organization: " Schmidt Sciences " }] });
    expect(parseTaggings(text, new Set(["7"]))[0]!.organization).toBe("Schmidt Sciences");
  });

  it("rejects malformed JSON", () => {
    expect(() => parseTaggings("{", new Set(["7"]))).toThrow(GeminiError);
  });
});
