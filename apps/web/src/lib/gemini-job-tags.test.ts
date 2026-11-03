import { afterEach, expect, it, vi } from "vitest";
import { requestGeminiJobTags } from "./gemini-job-tags";

afterEach(() => vi.unstubAllGlobals());

const job = { title: "Data Engineer", employerName: "State of Alaska", description: "Builds pipelines." };

it("posts one job to the tagging model with the API key and reads the answer", async () => {
  const fetcher = vi.fn(async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({
    roleTags: ["data-science-ai"], sectorTags: ["environment-energy"], seniority: "mid", summary: "Builds data pipelines.",
  }) }] } }] }));
  vi.stubGlobal("fetch", fetcher);

  expect(await requestGeminiJobTags("test-key", job)).toEqual({ outcome: "answer", answer: {
    tags: { roleTags: ["data-science-ai"], sectorTags: ["environment-energy"], seniority: "mid", summary: "Builds data pipelines." },
    defaultedToUnknown: false,
  } });
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent");
  expect(init).toMatchObject({ method: "POST", headers: { "x-goog-api-key": "test-key" } });
  expect(JSON.parse(String(init.body)).contents[0].parts[0].text).toContain("Title: Data Engineer");
});

it("reads a malformed completed answer as all unknown", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("not JSON")));
  expect(await requestGeminiJobTags("test-key", job)).toMatchObject({
    outcome: "answer", answer: { tags: { roleTags: ["unknown"], seniority: "unknown" }, defaultedToUnknown: true },
  });
});

it("reports HTTP and network failures as transient", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
  expect(await requestGeminiJobTags("test-key", job)).toEqual({ outcome: "transient-error", error: "Gemini: HTTP 503", status: 503 });
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
  expect(await requestGeminiJobTags("test-key", job)).toEqual({ outcome: "transient-error", error: "fetch failed", status: null });
});
