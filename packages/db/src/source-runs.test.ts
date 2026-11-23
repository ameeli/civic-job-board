import { beforeEach, describe, expect, it } from "vitest";
import { sourceRuns } from "./schema";
import type { Db } from "./client";
import { readFailingSources, recordSourceRun } from "./source-runs";
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

describe("readFailingSources", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("lists the sources whose latest run failed or stopped with an error", async () => {
    const earlier = new Date("2026-11-22T12:00:00Z");
    const later = new Date("2026-11-23T12:00:00Z");
    await recordSourceRun(db, { source: "recovered", startedAt: earlier, ok: false, error: "HTTP 503" });
    await recordSourceRun(db, { source: "recovered", startedAt: later, ok: true });
    await recordSourceRun(db, { source: "broke", startedAt: earlier, ok: true });
    await recordSourceRun(db, { source: "broke", startedAt: later, ok: false, error: "No listings found" });
    await recordSourceRun(db, { source: "unfinished", startedAt: later, error: "Timed out" });
    await recordSourceRun(db, { source: "running", startedAt: later });

    expect(await readFailingSources(db, ["recovered", "broke", "unfinished", "running", "never-run"]))
      .toEqual(["broke", "unfinished"]);
  });

  it("ignores runs of sources it was not asked about", async () => {
    await recordSourceRun(db, { source: "gemini-tagging", ok: false, error: "HTTP 429" });

    expect(await readFailingSources(db, ["broke"])).toEqual([]);
  });
});
