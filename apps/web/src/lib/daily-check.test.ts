import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { jobs, sourceRuns, type Db } from "@civic-job-board/db";
import { createTestDb } from "@civic-job-board/db/testing";
import record from "../../../../packages/core/src/fixtures/gov-listing.json";
import { dailyCheck } from "./daily-check";

// Real Gemini is never called: tests without a fake Gemini run with no key.
beforeEach(() => vi.stubEnv("GEMINI_API_KEY", ""));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const runsOf = async (db: Db, source: string) => (await db.select().from(sourceRuns).orderBy(sourceRuns.id)).filter(run => run.source === source);
const govRuns = (db: Db) => runsOf(db, "tech-jobs-for-gov");
const taggingRuns = (db: Db) => runsOf(db, "gemini-tagging");

it("saves API application links, then updates missing links to null", async () => {
  const db = await createTestDb();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json([{ ...record, meta: {
    _application: "https://example.org/?a=1&amp;b=2",
  } }]));
  vi.stubGlobal("fetch", fetcher);
  expect(await dailyCheck(db)).toMatchObject({ source: "tech-jobs-for-gov", ok: true, seen: 1, new: 1, error: null });
  expect(await db.select().from(jobs)).toMatchObject([{ applyUrl: "https://example.org/?a=1&b=2" }]);
  fetcher.mockResolvedValueOnce(Response.json([{ ...record, meta: {}, _job_salary: "Competitive" }]));
  expect(await dailyCheck(db)).toMatchObject({ ok: true, seen: 1, new: 0 });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(await db.select().from(jobs)).toMatchObject([{ salary: "Competitive", applyUrl: null }]);
  expect(await govRuns(db)).toHaveLength(2);
});

it("records empty results and source failures for the banner", async () => {
  const db = await createTestDb();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json([]))
    .mockResolvedValueOnce(new Response("", { status: 503 })));
  expect(await dailyCheck(db)).toMatchObject({ ok: true, seen: 0, new: 0 });
  expect(await dailyCheck(db)).toMatchObject({ ok: false, seen: 0, new: 0, error: "Tech Jobs for Gov API: HTTP 503" });
  expect(await govRuns(db)).toHaveLength(2);
});

it("retains successful saves and counts them when a later listing is invalid", async () => {
  const db = await createTestDb();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json([
    record, { ...record, id: null },
  ])));
  expect(await dailyCheck(db)).toMatchObject({
    ok: false, seen: 2, new: 1, error: "Invalid Tech Jobs for Gov listing",
  });
  expect(await db.select().from(jobs)).toHaveLength(1);
  expect(await govRuns(db)).toHaveLength(1);
});

it("records skipped tagging when GEMINI_API_KEY is unset while the source check still saves jobs", async () => {
  const db = await createTestDb();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json([record]));
  vi.stubGlobal("fetch", fetcher);
  expect(await dailyCheck(db)).toMatchObject({ source: "tech-jobs-for-gov", ok: true, new: 1 });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(await taggingRuns(db)).toMatchObject([{ ok: false, seen: 0, new: 0, error: "GEMINI_API_KEY is not set; tagging skipped" }]);
  expect(await db.select().from(jobs)).toMatchObject([{ roleTags: null, taggedAt: null }]);
});

it("tags each new job once with a fake Gemini and leaves failed requests for the next run", async () => {
  const db = await createTestDb();
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  const listings = [4296, 4297, 4298].map((id, day) => ({ ...record, id, date_gmt: `2026-10-0${day + 1}T00:00:00` }));
  const geminiAnswer = (fields: object) => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(fields) }] } }] });
  const gemini = vi.fn()
    .mockResolvedValueOnce(geminiAnswer({ roleTags: ["infrastructure-devops", "made-up"], sectorTags: ["general-government"], seniority: "senior", summary: "Runs cloud platforms for Louisiana." }))
    .mockResolvedValueOnce(new Response("", { status: 429 }))
    .mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts: [{ text: '{"roleTags": [' }] }, finishReason: "MAX_TOKENS" }] }))
    .mockResolvedValueOnce(geminiAnswer({ roleTags: ["security"], sectorTags: ["unknown"], seniority: "mid", summary: "Secures systems." }));
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => url.startsWith("https://civicworkstudio.com/")
    ? Promise.resolve(Response.json(listings)) : gemini(url, init)));
  const sleep = vi.fn(async () => {});

  await dailyCheck(db, { sleep });
  const [firstRequest] = gemini.mock.calls[0]!;
  expect(firstRequest).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent");
  expect(gemini.mock.calls[0]![1].headers).toMatchObject({ "x-goog-api-key": "test-key" });
  expect(sleep.mock.calls).toEqual([[6_500], [6_500]]);
  expect(await taggingRuns(db)).toMatchObject([{ ok: false, seen: 3, new: 2, defaultedToUnknown: 1, error: "Gemini: HTTP 429" }]);
  const byId = async () => Object.fromEntries((await db.select().from(jobs)).map(job => [job.sourceJobId, job]));
  expect(await byId()).toMatchObject({
    4296: { roleTags: ["infrastructure-devops"], sectorTags: ["general-government"], seniority: "senior", summary: "Runs cloud platforms for Louisiana." },
    4297: { roleTags: null, taggedAt: null },
    4298: { roleTags: ["unknown"], sectorTags: ["unknown"], seniority: "unknown", summary: null },
  });

  await dailyCheck(db, { sleep });
  expect(gemini).toHaveBeenCalledTimes(4);
  expect((await taggingRuns(db))[1]).toMatchObject({ ok: true, seen: 1, new: 1, defaultedToUnknown: 0, error: null });
  expect((await byId())[4297]).toMatchObject({ roleTags: ["security"], sectorTags: ["unknown"], seniority: "mid" });

  await dailyCheck(db, { sleep });
  expect(gemini).toHaveBeenCalledTimes(4);
  expect((await taggingRuns(db))[2]).toMatchObject({ ok: true, seen: 0, new: 0 });
});

it("stops tagging when the run's time budget runs low", async () => {
  const db = await createTestDb();
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.useFakeTimers({ toFake: ["Date"] });
  const gemini = vi.fn().mockResolvedValue(Response.json({}));
  vi.stubGlobal("fetch", vi.fn((url: string) => url.startsWith("https://civicworkstudio.com/")
    ? Promise.resolve(Response.json([record, { ...record, id: 2 }])) : gemini()));
  await dailyCheck(db, { sleep: async () => vi.setSystemTime(Date.now() + 261_000) });
  expect(gemini).toHaveBeenCalledOnce();
  expect(await taggingRuns(db)).toMatchObject([{ ok: true, seen: 1, new: 1, defaultedToUnknown: 1 }]);
});
