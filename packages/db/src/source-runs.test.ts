import { beforeEach, describe, expect, it } from "vitest";
import { sourceRuns } from "./schema";
import { latestSourceRuns, recordSourceRun, sourcesCheckedSince, type Db } from "./source-runs";
import { createTestDb } from "./testing";

describe("recordSourceRun", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("inserts a finished run and returns it with defaults filled in", async () => {
    const startedAt = new Date("2026-10-16T12:00:00Z");
    const finishedAt = new Date("2026-10-16T12:00:05Z");

    const row = await recordSourceRun(db, {
      source: "daily",
      startedAt,
      finishedAt,
      ok: true,
    });

    expect(row).toEqual({
      id: 1,
      source: "daily",
      startedAt,
      finishedAt,
      ok: true,
      seen: 0,
      new: 0,
      error: null,
      partial: false,
    });
    expect(await db.select().from(sourceRuns)).toEqual([row]);
  });

  it("records a failed run with its error", async () => {
    const row = await recordSourceRun(db, {
      source: "example-board",
      ok: false,
      seen: 3,
      new: 1,
      error: "HTTP 503",
    });

    expect(row).toMatchObject({ ok: false, seen: 3, new: 1, error: "HTTP 503" });
    expect(row.startedAt).toBeInstanceOf(Date);
    expect(row.finishedAt).toBeNull();
  });

  it("tells which sources finished a full check since a time", async () => {
    const since = new Date("2026-10-20T12:00:00Z");
    await recordSourceRun(db, { source: "old", startedAt: new Date("2026-10-19T13:00:00Z"), finishedAt: new Date("2026-10-19T13:01:00Z"), ok: true });
    await recordSourceRun(db, { source: "done", startedAt: new Date("2026-10-20T13:00:00Z"), finishedAt: new Date("2026-10-20T13:01:00Z"), ok: true });
    await recordSourceRun(db, { source: "failed", startedAt: new Date("2026-10-20T13:00:00Z"), finishedAt: new Date("2026-10-20T13:01:00Z"), ok: false, error: "HTTP 500" });
    await recordSourceRun(db, { source: "partial", startedAt: new Date("2026-10-20T13:00:00Z"), finishedAt: new Date("2026-10-20T13:04:00Z"), ok: true, partial: true });

    expect([...(await sourcesCheckedSince(db, since))].sort()).toEqual(["done", "failed"]);
  });

  it("returns each source's latest finished check", async () => {
    await recordSourceRun(db, { source: "a", startedAt: new Date("2026-10-19T13:00:00Z"), finishedAt: new Date("2026-10-19T13:01:00Z"), ok: false, error: "x" });
    await recordSourceRun(db, { source: "a", startedAt: new Date("2026-10-20T13:00:00Z"), finishedAt: new Date("2026-10-20T13:01:00Z"), ok: true, seen: 0 });
    await recordSourceRun(db, { source: "b", startedAt: new Date("2026-10-20T13:00:00Z"), finishedAt: new Date("2026-10-20T13:01:00Z"), ok: true, seen: 4 });

    const latest = await latestSourceRuns(db);
    expect(latest.map((run) => [run.source, run.ok, run.seen])).toEqual([
      ["a", true, 0],
      ["b", true, 4],
    ]);
  });
});

