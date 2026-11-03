import { afterEach, expect, it, vi } from "vitest";
import { logDailyCheck } from "./daily-check-log";

afterEach(() => vi.restoreAllMocks());

it("prints one prefixed key=value line, quoting values with spaces, quotes, or equals signs", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  logDailyCheck("tagging-job", { n: "2/31", outcome: "transient-error", status: 503, error: 'Gemini: HTTP 503', ok: false, next: null });
  logDailyCheck("run-start");
  expect(log.mock.calls).toEqual([
    ['[daily-check] tagging-job n=2/31 outcome=transient-error status=503 error="Gemini: HTTP 503" ok=false next=null'],
    ["[daily-check] run-start"],
  ]);
});
