import { beforeEach, describe, expect, it } from "vitest";
import { sourceRuns } from "./schema";
import { recordSourceRun, type Db } from "./source-runs";
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
