import { beforeEach, describe, expect, it } from "vitest";
import { acquireLease, releaseLease } from "./leases";
import type { Db } from "./source-runs";
import { createTestDb } from "./testing";

const NOW = new Date("2026-10-20T13:00:00Z");
const in5min = new Date(NOW.getTime() + 300_000);

describe("leases", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("lets only one holder in until the lease is released or expires", async () => {
    expect(await acquireLease(db, { name: "daily", holder: "a", expiresAt: in5min, now: NOW })).toBe(true);
    expect(await acquireLease(db, { name: "daily", holder: "b", expiresAt: in5min, now: NOW })).toBe(false);
    // The holder may extend its own lease.
    expect(await acquireLease(db, { name: "daily", holder: "a", expiresAt: in5min, now: NOW })).toBe(true);

    await releaseLease(db, { name: "daily", holder: "b" });
    expect(await acquireLease(db, { name: "daily", holder: "b", expiresAt: in5min, now: NOW })).toBe(false);

    await releaseLease(db, { name: "daily", holder: "a" });
    expect(await acquireLease(db, { name: "daily", holder: "b", expiresAt: in5min, now: NOW })).toBe(true);
  });

  it("can be taken over once expired", async () => {
    await acquireLease(db, { name: "daily", holder: "a", expiresAt: in5min, now: NOW });
    expect(await acquireLease(db, { name: "daily", holder: "b", expiresAt: new Date(in5min.getTime() + 300_000), now: in5min })).toBe(true);
  });
});
