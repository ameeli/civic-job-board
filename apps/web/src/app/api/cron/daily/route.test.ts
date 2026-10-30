import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dailyCheck } = vi.hoisted(() => ({ dailyCheck: vi.fn() }));

vi.mock("@/lib/daily-check", () => ({ dailyCheck }));
vi.mock("@/lib/db", () => ({ getDb: () => "fake-db" }));

import { GET } from "./route";

const secret = "test-cron-secret";

const sourceRun = { id: 42, ok: true, seen: 319, new: 2, error: null };
const taggingRun = { ok: true, new: 30, defaultedToUnknown: 1, error: null };

function cronRequest(authorization?: string): Request {
  return new Request("http://localhost/api/cron/daily", {
    headers: authorization ? { authorization } : {},
  });
}

describe("GET /api/cron/daily", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", secret);
    dailyCheck.mockResolvedValue({ sourceRun, taggingRun, transientFailures: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    dailyCheck.mockReset();
  });

  it("runs the daily check and reports every part as ok", async () => {
    const response = await GET(cronRequest(`Bearer ${secret}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true, runId: 42,
      fetch: { ok: true, seen: 319, new: 2 },
      tagging: { ok: true, tagged: 30, defaulted: 1, transient: 0 },
    });
    expect(dailyCheck).toHaveBeenCalledOnce();
    expect(dailyCheck).toHaveBeenCalledWith("fake-db");
  });

  it("reports failed tagging in a completed run", async () => {
    dailyCheck.mockResolvedValue({
      sourceRun: { ...sourceRun, new: 0 },
      taggingRun: { ok: false, new: 0, defaultedToUnknown: 0, error: "Gemini: HTTP 503" },
      transientFailures: 27,
    });
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false, runId: 42,
      fetch: { ok: true, seen: 319, new: 0 },
      tagging: { ok: false, tagged: 0, defaulted: 0, transient: 27, error: "Gemini: HTTP 503" },
    });
  });

  it("reports skipped tagging when GEMINI_API_KEY is unset", async () => {
    dailyCheck.mockResolvedValue({
      sourceRun,
      taggingRun: { ok: false, new: 0, defaultedToUnknown: 0, error: "GEMINI_API_KEY is not set; tagging skipped" },
      transientFailures: 0,
    });
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false, runId: 42,
      fetch: { ok: true, seen: 319, new: 2 },
      tagging: { ok: false, tagged: 0, defaulted: 0, transient: 0, error: "GEMINI_API_KEY is not set; tagging skipped" },
    });
  });

  it("reports a failed source fetch", async () => {
    dailyCheck.mockResolvedValue({
      sourceRun: { ...sourceRun, ok: false, seen: 0, new: 0, error: "Tech Jobs for Gov API: HTTP 503" },
      taggingRun, transientFailures: 0,
    });
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: false, fetch: { ok: false, seen: 0, new: 0, error: "Tech Jobs for Gov API: HTTP 503" },
    });
  });

  it("answers 500 when the run itself throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    dailyCheck.mockRejectedValue(new Error("database unreachable"));
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "The daily check failed; see the logs" });
    expect(console.error).toHaveBeenCalledWith("[daily-check] run-failed", expect.any(Error));
  });

  it("rejects a request without the cron secret", async () => {
    const response = await GET(cronRequest());

    expect(response.status).toBe(401);
    expect(dailyCheck).not.toHaveBeenCalled();
  });

  it("rejects every request when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const response = await GET(cronRequest("Bearer "));

    expect(response.status).toBe(401);
    expect(dailyCheck).not.toHaveBeenCalled();
  });
});
