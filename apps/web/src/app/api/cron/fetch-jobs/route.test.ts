import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchAndSaveJobs } = vi.hoisted(() => ({ fetchAndSaveJobs: vi.fn() }));

vi.mock("@/lib/daily-check", () => ({ fetchAndSaveJobs }));
vi.mock("@/lib/db", () => ({ getDb: () => "fake-db" }));

import { GET } from "./route";

const secret = "test-cron-secret";

const govRun = { id: 42, source: "tech-jobs-for-gov", ok: true, seen: 319, new: 2, error: null };
const ctfgRun = { id: 43, source: "civic-tech-field-guide", ok: true, seen: 100, new: 5, error: null };

function cronRequest(authorization?: string): Request {
  return new Request("http://localhost/api/cron/fetch-jobs", {
    headers: authorization ? { authorization } : {},
  });
}

describe("GET /api/cron/fetch-jobs", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", secret);
    fetchAndSaveJobs.mockResolvedValue([govRun, ctfgRun]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fetchAndSaveJobs.mockReset();
  });

  it("fetches and saves jobs and reports each source's check", async () => {
    const response = await GET(cronRequest(`Bearer ${secret}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      fetch: [
        { source: "tech-jobs-for-gov", runId: 42, ok: true, seen: 319, new: 2 },
        { source: "civic-tech-field-guide", runId: 43, ok: true, seen: 100, new: 5 },
      ],
    });
    expect(fetchAndSaveJobs).toHaveBeenCalledOnce();
    expect(fetchAndSaveJobs).toHaveBeenCalledWith("fake-db");
  });

  it("answers 200 with ok false when one source fails without throwing", async () => {
    fetchAndSaveJobs.mockResolvedValue([
      { ...govRun, ok: false, seen: 0, new: 0, error: "Tech Jobs for Gov API: HTTP 503" }, ctfgRun,
    ]);
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false,
      fetch: [
        { source: "tech-jobs-for-gov", runId: 42, ok: false, seen: 0, new: 0, error: "Tech Jobs for Gov API: HTTP 503" },
        { source: "civic-tech-field-guide", runId: 43, ok: true, seen: 100, new: 5 },
      ],
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
});
