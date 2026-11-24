import { beforeEach, describe, expect, it } from "vitest";
import { sourceRuns } from "./schema";
import type { Db } from "./client";
import { readSourceProblems, recordSourceRun } from "./source-runs";
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
      defaultedToUnknown: 0,
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
});

describe("readSourceProblems", () => {
  const now = new Date("2026-11-23T12:00:00Z");
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("lists the sources whose latest run failed or stopped with an error", async () => {
    await recordSourceRun(db, { source: "recovered", startedAt: hoursAgo(25), ok: false, error: "HTTP 503" });
    await recordSourceRun(db, { source: "recovered", startedAt: hoursAgo(1), ok: true });
    await recordSourceRun(db, { source: "broke", startedAt: hoursAgo(25), ok: true });
    await recordSourceRun(db, { source: "broke", startedAt: hoursAgo(1), ok: false, error: "No listings found" });
    await recordSourceRun(db, { source: "unfinished", startedAt: hoursAgo(1), error: "Timed out" });
    await recordSourceRun(db, { source: "running", startedAt: hoursAgo(1) });

    expect(await readSourceProblems(db, ["recovered", "broke", "unfinished", "running", "never-run"], now))
      .toEqual({ failed: ["broke", "unfinished"], stale: [] });
  });

  it("lists sources whose latest run started more than 36 hours ago as stale, with that start", async () => {
    await recordSourceRun(db, { source: "fresh", startedAt: hoursAgo(36), ok: true });
    await recordSourceRun(db, { source: "stale", startedAt: hoursAgo(37), ok: true });
    await recordSourceRun(db, { source: "stale-and-failed", startedAt: hoursAgo(48), ok: false, error: "HTTP 503" });

    expect(await readSourceProblems(db, ["fresh", "stale", "stale-and-failed"], now)).toEqual({
      failed: [],
      stale: [
        { source: "stale", lastStartedAt: hoursAgo(37) },
        { source: "stale-and-failed", lastStartedAt: hoursAgo(48) },
      ],
    });
  });

  it("ignores runs of sources it was not asked about", async () => {
    await recordSourceRun(db, { source: "gemini-tagging", startedAt: hoursAgo(48), ok: false, error: "HTTP 429" });

    expect(await readSourceProblems(db, ["broke"], now)).toEqual({ failed: [], stale: [] });
  });
});
