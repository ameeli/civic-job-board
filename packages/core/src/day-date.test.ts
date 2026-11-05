import { expect, it } from "vitest";
import { dayDate } from "./day-date";

it("reads a day with no time as midnight UTC, and anything else as no date", () => {
  expect(dayDate("2026-10-16")).toEqual(new Date("2026-10-16T00:00:00Z"));
  expect([dayDate("Oct 16"), dayDate("2026-10-16T08:00:00Z"), dayDate(""), dayDate(null)]).toEqual([null, null, null, null]);
});
