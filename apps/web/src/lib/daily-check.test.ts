import { afterEach, expect, it, vi } from "vitest";
import { jobs, sourceRuns } from "@civic-job-board/db";
import { createTestDb } from "@civic-job-board/db/testing";
import record from "../../../../packages/core/src/fixtures/gov-listing.json";
import { dailyCheck } from "./daily-check";

afterEach(() => vi.unstubAllGlobals());

it("runs API -> page fallback -> database, then updates without another page fetch", async () => {
  const db = await createTestDb();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json([{ ...record, meta: {} }]))
    .mockResolvedValueOnce(new Response('<a class="cws-apply-button" href="https://example.org/apply">Apply</a>'));
  vi.stubGlobal("fetch", fetcher);
  expect(await dailyCheck(db)).toMatchObject({ source: "tech-jobs-for-gov", ok: true, seen: 1, new: 1, error: null });
  fetcher.mockResolvedValueOnce(Response.json([{ ...record, meta: {}, _job_salary: "Competitive" }]));
  expect(await dailyCheck(db)).toMatchObject({ ok: true, seen: 1, new: 0 });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(await db.select().from(jobs)).toMatchObject([{ salary: "Competitive", applyUrl: "https://example.org/apply" }]);
  expect(await db.select().from(sourceRuns)).toHaveLength(2);
});

it("records empty results and source failures for the banner", async () => {
  const db = await createTestDb();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json([]))
    .mockResolvedValueOnce(new Response("", { status: 503 })));
  expect(await dailyCheck(db)).toMatchObject({ ok: true, seen: 0, new: 0 });
  expect(await dailyCheck(db)).toMatchObject({ ok: false, seen: 0, new: 0, error: "Tech Jobs for Gov API: HTTP 503" });
  expect(await db.select().from(sourceRuns)).toHaveLength(2);
});

it("retains successful saves and counts them when a later page request fails", async () => {
  const db = await createTestDb();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json([
    record, { ...record, id: 999, meta: {} },
  ])).mockResolvedValueOnce(new Response("", { status: 502 })));
  expect(await dailyCheck(db)).toMatchObject({
    ok: false, seen: 2, new: 1, error: "Tech Jobs for Gov page: HTTP 502",
  });
  expect(await db.select().from(jobs)).toHaveLength(1);
  expect(await db.select().from(sourceRuns)).toHaveLength(1);
});
