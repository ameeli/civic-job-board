import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchAndSaveJobs } = vi.hoisted(() => ({ fetchAndSaveJobs: vi.fn() }));

vi.mock("@/lib/daily-check", () => ({ fetchAndSaveJobs }));
vi.mock("@/lib/db", () => ({ getDb: () => "fake-db" }));

import { GET } from "./route";

const secret = "test-cron-secret";

const sourceRun = { id: 42, ok: true, seen: 319, new: 2, error: null };

function cronRequest(authorization?: string): Request {
  return new Request("http://localhost/api/cron/fetch-jobs", {
    headers: authorization ? { authorization } : {},
  });
}

describe("GET /api/cron/fetch-jobs", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", secret);
    fetchAndSaveJobs.mockResolvedValue(sourceRun);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fetchAndSaveJobs.mockReset();
  });

  it("fetches and saves jobs and reports the fetch as ok", async () => {
    const response = await GET(cronRequest(`Bearer ${secret}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true, runId: 42, fetch: { ok: true, seen: 319, new: 2 },
    });
    expect(fetchAndSaveJobs).toHaveBeenCalledOnce();
    expect(fetchAndSaveJobs).toHaveBeenCalledWith("fake-db");
  });

  it("answers 200 with ok false when the source fetch fails without throwing", async () => {
    fetchAndSaveJobs.mockResolvedValue({ ...sourceRun, ok: false, seen: 0, new: 0, error: "Tech Jobs for Gov API: HTTP 503" });
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false, runId: 42, fetch: { ok: false, seen: 0, new: 0, error: "Tech Jobs for Gov API: HTTP 503" },
    });
  });

  it("answers 500 when the run itself throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchAndSaveJobs.mockRejectedValue(new Error("database unreachable"));
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "The job fetch failed; see the logs" });
    expect(console.error).toHaveBeenCalledWith("[daily-check] fetch-run-failed", expect.any(Error));
  });

  it("rejects a request without the cron secret", async () => {
    const response = await GET(cronRequest());

    expect(response.status).toBe(401);
    expect(fetchAndSaveJobs).not.toHaveBeenCalled();
  });

  it("rejects every request when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const response = await GET(cronRequest("Bearer "));

    expect(response.status).toBe(401);
    expect(fetchAndSaveJobs).not.toHaveBeenCalled();
  });
});
