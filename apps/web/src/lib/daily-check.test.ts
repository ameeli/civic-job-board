import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { jobs, readJobsToTag, saveJobTags, sourceRuns, type Db } from "@civic-job-board/db";
import { createTestDb } from "@civic-job-board/db/testing";
import record from "../../../../packages/core/src/fixtures/gov-listing.json";
import { dailyCheck } from "./daily-check";

// Real Gemini is never called: tests without a fake Gemini run with no key.
beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const runsOf = async (db: Db, source: string) => (await db.select().from(sourceRuns).orderBy(sourceRuns.id)).filter(run => run.source === source);
const govRuns = (db: Db) => runsOf(db, "tech-jobs-for-gov");
const taggingRuns = (db: Db) => runsOf(db, "gemini-tagging");
const logLines = () => vi.mocked(console.log).mock.calls.map(([line]) => String(line));

it("saves API application links, then updates missing links to null", async () => {
  const db = await createTestDb();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json([{ ...record, meta: {
    _application: "https://example.org/?a=1&amp;b=2",
  } }]));
  vi.stubGlobal("fetch", fetcher);
  expect((await dailyCheck(db)).sourceRun).toMatchObject({ source: "tech-jobs-for-gov", ok: true, seen: 1, new: 1, error: null });
  expect(await db.select().from(jobs)).toMatchObject([{ applyUrl: "https://example.org/?a=1&b=2" }]);
  fetcher.mockResolvedValueOnce(Response.json([{ ...record, meta: {}, _job_salary: "Competitive" }]));
  expect((await dailyCheck(db)).sourceRun).toMatchObject({ ok: true, seen: 1, new: 0 });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(await db.select().from(jobs)).toMatchObject([{ salary: "Competitive", applyUrl: null }]);
  expect(await govRuns(db)).toHaveLength(2);
});

it("records empty results and source failures for the banner", async () => {
  const db = await createTestDb();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json([]))
    .mockResolvedValueOnce(new Response("", { status: 503 })));
  expect((await dailyCheck(db)).sourceRun).toMatchObject({ ok: true, seen: 0, new: 0 });
  expect((await dailyCheck(db)).sourceRun).toMatchObject({ ok: false, seen: 0, new: 0, error: "Tech Jobs for Gov API: HTTP 503" });
  expect(await govRuns(db)).toHaveLength(2);
});

it("retains successful saves and counts them when a later listing is invalid", async () => {
  const db = await createTestDb();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json([
    record, { ...record, id: null },
  ])));
  expect((await dailyCheck(db)).sourceRun).toMatchObject({
    ok: false, seen: 2, new: 1, error: "Invalid Tech Jobs for Gov listing",
  });
  expect(await db.select().from(jobs)).toHaveLength(1);
  expect(await govRuns(db)).toHaveLength(1);
});

it("records skipped tagging when GEMINI_API_KEY is unset while the source check still saves jobs", async () => {
  const db = await createTestDb();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json([record]));
  vi.stubGlobal("fetch", fetcher);
  expect((await dailyCheck(db)).sourceRun).toMatchObject({ source: "tech-jobs-for-gov", ok: true, new: 1 });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(await taggingRuns(db)).toMatchObject([{ ok: false, seen: 0, new: 0, error: "GEMINI_API_KEY is not set; tagging skipped" }]);
  expect(logLines()).toContainEqual("[daily-check] tagging-skipped reason=missing-api-key");
  expect(await db.select().from(jobs)).toMatchObject([{ roleTags: null, taggedAt: null }]);
});

it("tags each new job once with a fake Gemini and leaves failed requests for the next run", async () => {
  const db = await createTestDb();
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  const listings = [4296, 4297, 4298].map((id, day) => ({ ...record, id, date_gmt: `2026-10-0${day + 1}T00:00:00` }));
  const geminiAnswer = (fields: object) => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(fields) }] } }] });
  const gemini = vi.fn()
    .mockResolvedValueOnce(geminiAnswer({ roleTags: ["infrastructure-devops", "made-up"], sectorTags: ["general-government"], seniority: "senior", summary: "Runs cloud platforms for Louisiana." }))
    .mockResolvedValueOnce(new Response("", { status: 500 }))
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
  expect(await taggingRuns(db)).toMatchObject([{ ok: false, seen: 3, new: 2, defaultedToUnknown: 1, error: "Gemini: HTTP 500" }]);
  const [jobA, jobB, jobC] = (await db.select().from(jobs).orderBy(jobs.postedAt)).map(job => job.id);
  expect(logLines()).toEqual([
    "[daily-check] run-start",
    "[daily-check] source-start source=tech-jobs-for-gov",
    expect.stringMatching(/^\[daily-check\] source-done source=tech-jobs-for-gov ok=true fetched=3 saved=3 new=3 duration_ms=\d+$/),
    "[daily-check] tagging-start selected=3 cap=35",
    expect.stringMatching(new RegExp(`^\\[daily-check\\] tagging-job n=1/3 job_id=${jobA} outcome=tagged attempts=1 duration_ms=\\d+$`)),
    expect.stringMatching(new RegExp(`^\\[daily-check\\] tagging-job n=2/3 job_id=${jobB} outcome=transient-error status=500 error="Gemini: HTTP 500" attempts=1 duration_ms=\\d+$`)),
    expect.stringMatching(new RegExp(`^\\[daily-check\\] tagging-job n=3/3 job_id=${jobC} outcome=defaulted-to-unknown attempts=1 duration_ms=\\d+$`)),
    expect.stringMatching(/^\[daily-check\] run-done fetched=3 new=3 tagged=2 defaulted_to_unknown=1 transient_failures=1 duration_ms=\d+$/),
  ]);
  expect(logLines().join("\n")).not.toMatch(/test-key|Interested in advancing/);
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
  expect(logLines()).toContainEqual("[daily-check] tagging-stopped reason=time-budget untagged=1");
  expect(await taggingRuns(db)).toMatchObject([{ ok: true, seen: 1, new: 1, defaultedToUnknown: 1 }]);
});

it.each([
  new TypeError("Connection reset"),
  new DOMException("Body aborted", "AbortError"),
  new DOMException("Body timed out", "TimeoutError"),
])("retries jobs after response body read failure: %s", async failure => {
  const db = await createTestDb();
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  const interrupted = new Response(new ReadableStream({
    start(controller) { controller.error(failure); },
  }));
  const gemini = vi.fn().mockResolvedValueOnce(interrupted).mockResolvedValueOnce(new Response("invalid JSON"));
  vi.stubGlobal("fetch", vi.fn((url: string) => url.startsWith("https://civicworkstudio.com/")
    ? Promise.resolve(Response.json([record])) : gemini()));

  await dailyCheck(db);
  expect(await db.select().from(jobs)).toMatchObject([{ taggedAt: null, roleTags: null }]);
  expect(await taggingRuns(db)).toMatchObject([{
    ok: false, seen: 1, new: 0, defaultedToUnknown: 0, error: failure.message,
  }]);
  expect(logLines()).toContainEqual(expect.stringMatching(/ outcome=transient-error error="[^"]+" attempts=1 duration_ms=\d+$/));

  await dailyCheck(db);
  expect(gemini).toHaveBeenCalledTimes(2);
  expect((await taggingRuns(db))[1]).toMatchObject({
    ok: true, seen: 1, new: 1, defaultedToUnknown: 1, error: null,
  });
  expect(await db.select().from(jobs)).toMatchObject([{
    taggedAt: expect.any(Date), roleTags: ["unknown"], sectorTags: ["unknown"], seniority: "unknown",
  }]);
});

it.each([true, false])("does not count a skipped tag save when the answer is unusable: %s", async unusable => {
  const db = await createTestDb();
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  const tags = { roleTags: ["security"], sectorTags: ["education"], seniority: "senior", summary: "Secures schools." };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.startsWith("https://civicworkstudio.com/")) return Response.json([record]);
    const [pending] = await readJobsToTag(db, 1);
    await saveJobTags(db, pending!.id, tags);
    return Response.json(unusable ? {} : { candidates: [{ content: { parts: [{ text: JSON.stringify({
      ...tags, roleTags: ["software-engineering"],
    }) }] } }] });
  }));

  await dailyCheck(db);
  expect(await taggingRuns(db)).toMatchObject([{
    ok: true, seen: 1, new: 0, defaultedToUnknown: 0, error: null,
  }]);
  expect(await db.select().from(jobs)).toMatchObject([tags]);
});

const taggedAnswer = () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({
  roleTags: ["security"], sectorTags: ["education"], seniority: "mid", summary: "Secures schools.",
}) }] } }] });

function fakeGeminiFor(listings: object[], gemini: () => Promise<Response>) {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubGlobal("fetch", vi.fn((url: string) => url.startsWith("https://civicworkstudio.com/")
    ? Promise.resolve(Response.json(listings)) : gemini()));
}

const fourListings = [1, 2, 3, 4].map(id => ({ ...record, id, date_gmt: `2026-10-0${id}T00:00:00` }));

it.each([[429, "rate-limited"], [503, "overloaded"]])("retries twice, then stops tagging for the run after HTTP %i", async (status, reason) => {
  const db = await createTestDb();
  const gemini = vi.fn().mockResolvedValueOnce(taggedAnswer())
    .mockImplementation(async () => new Response("", { status }));
  fakeGeminiFor(fourListings, gemini);
  const sleep = vi.fn(async () => {});

  await dailyCheck(db, { sleep });
  expect(gemini).toHaveBeenCalledTimes(4);
  expect(sleep.mock.calls).toEqual([[6_500], [30_000], [60_000]]);
  expect(await taggingRuns(db)).toMatchObject([{ ok: false, seen: 4, new: 1, defaultedToUnknown: 0, error: `Gemini: HTTP ${status}` }]);
  const [, second] = (await db.select().from(jobs).orderBy(jobs.postedAt)).map(job => job.id);
  expect((await db.select().from(jobs)).filter(job => job.taggedAt === null)).toHaveLength(3);
  expect(logLines()).toEqual(expect.arrayContaining([
    `[daily-check] tagging-retry job_id=${second} attempt=2 status=${status} wait_s=30`,
    `[daily-check] tagging-retry job_id=${second} attempt=3 status=${status} wait_s=60`,
    expect.stringMatching(new RegExp(`^\\[daily-check\\] tagging-job n=2/4 job_id=${second} outcome=transient-error status=${status} error="Gemini: HTTP ${status}" attempts=3 duration_ms=\\d+$`)),
    `[daily-check] tagging-stopped reason=${reason} status=${status} untagged=2`,
  ]));
  expect(logLines().at(-1)).toMatch(/^\[daily-check\] run-done fetched=4 new=4 tagged=1 defaulted_to_unknown=0 transient_failures=3 duration_ms=\d+$/);
});

it.each([429, 503].flatMap(status => [1, 2].map(retry => ({ status, retry }))))(
  "continues the backlog after HTTP $status recovers on retry $retry", async ({ status, retry }) => {
    const db = await createTestDb();
    const gemini = vi.fn();
    for (let attempt = 0; attempt < retry; attempt++) {
      gemini.mockResolvedValueOnce(new Response("", { status }));
    }
    gemini.mockImplementation(async () => taggedAnswer());
    fakeGeminiFor(fourListings.slice(0, 2), gemini);
    const sleep = vi.fn(async () => {});

    const { taggingRun, transientFailures } = await dailyCheck(db, { sleep });
    expect(gemini).toHaveBeenCalledTimes(retry + 2);
    expect(sleep.mock.calls).toEqual(retry === 1 ? [[30_000], [6_500]] : [[30_000], [60_000], [6_500]]);
    expect(taggingRun).toMatchObject({ ok: true, seen: 2, new: 2, error: null });
    expect(transientFailures).toBe(0);
    expect(await readJobsToTag(db, 35)).toHaveLength(0);
  },
);

it.each([429, 503].flatMap(status => [1, 2].flatMap(retry =>
  ["http", "timeout", "transport", "body"].map(failure => ({ status, retry, failure })),
)))("stops after HTTP $status recovery ends in $failure on retry $retry", async ({ status, retry, failure }) => {
  const db = await createTestDb();
  const gemini = vi.fn();
  for (let attempt = 0; attempt < retry; attempt++) {
    gemini.mockResolvedValueOnce(new Response("", { status }));
  }
  const error = failure === "timeout" ? new DOMException("Timed out", "TimeoutError") : new TypeError("Connection reset");
  if (failure === "http") {
    gemini.mockResolvedValueOnce(new Response("", { status: 500 }));
  } else if (failure === "body") {
    gemini.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) { controller.error(error); },
    })));
  } else {
    gemini.mockRejectedValueOnce(error);
  }
  gemini.mockImplementation(async () => taggedAnswer());
  fakeGeminiFor(fourListings, gemini);
  const sleep = vi.fn(async () => {});

  const { taggingRun, transientFailures } = await dailyCheck(db, { sleep });
  expect(gemini).toHaveBeenCalledTimes(retry + 1);
  expect(sleep.mock.calls).toEqual(retry === 1 ? [[30_000]] : [[30_000], [60_000]]);
  expect(taggingRun).toMatchObject({
    ok: false, seen: 4, new: 0, defaultedToUnknown: 0,
    error: failure === "http" ? "Gemini: HTTP 500" : error.message,
  });
  expect(transientFailures).toBe(4);
  expect(await readJobsToTag(db, 35)).toHaveLength(4);
  expect(logLines()).toContainEqual(
    `[daily-check] tagging-stopped reason=${status === 429 ? "rate-limited" : "overloaded"} status=${status} untagged=3`,
  );
});

it("stops instead of starting a retry wait that would run past the time budget", async () => {
  const db = await createTestDb();
  vi.useFakeTimers({ toFake: ["Date"] });
  const gemini = vi.fn().mockImplementation(async () => {
    vi.setSystemTime(Date.now() + 240_000);
    return new Response("", { status: 503 });
  });
  fakeGeminiFor(fourListings.slice(0, 2), gemini);
  const sleep = vi.fn(async () => {});

  await dailyCheck(db, { sleep });
  expect(gemini).toHaveBeenCalledOnce();
  expect(sleep).not.toHaveBeenCalled();
  expect(await taggingRuns(db)).toMatchObject([{ ok: false, seen: 2, new: 0, error: "Gemini: HTTP 503" }]);
  expect(logLines()).toContainEqual(expect.stringMatching(/ tagging-retry-skipped job_id=\S+ status=503 wait_s=30 reason=time-budget$/));
  expect(logLines()).toContainEqual("[daily-check] tagging-stopped reason=overloaded status=503 untagged=1");
});
