import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchAndSaveSource } = vi.hoisted(() => ({ fetchAndSaveSource: vi.fn() }));

vi.mock("@/lib/daily-check", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/daily-check")>(), fetchAndSaveSource,
}));
vi.mock("@/lib/db", () => ({ getDb: () => "fake-db" }));

import { GET } from "./route";

const secret = "test-cron-secret";

const govRun = { id: 42, source: "tech-jobs-for-gov", ok: true, seen: 319, new: 2, error: null };

function cronRequest(source: string, authorization?: string) {
  const request = new Request(`http://localhost/api/cron/fetch-jobs/${source}`, {
    headers: authorization ? { authorization } : {},
  });
  return GET(request, { params: Promise.resolve({ source }) });
}

describe("GET /api/cron/fetch-jobs/[source]", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", secret);
    fetchAndSaveSource.mockResolvedValue(govRun);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fetchAndSaveSource.mockReset();
  });

  it("fetches and saves the named source's jobs and reports its check", async () => {
    const response = await cronRequest("tech-jobs-for-gov", `Bearer ${secret}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true, runId: 42, fetch: { source: "tech-jobs-for-gov", ok: true, seen: 319, new: 2 },
    });
    expect(fetchAndSaveSource).toHaveBeenCalledOnce();
    expect(fetchAndSaveSource).toHaveBeenCalledWith("fake-db", "tech-jobs-for-gov");
  });

  it("answers 200 with ok false when the source's check fails without throwing", async () => {
    fetchAndSaveSource.mockResolvedValue({ ...govRun, ok: false, seen: 0, new: 0, error: "Tech Jobs for Gov API: HTTP 503" });
    const response = await cronRequest("tech-jobs-for-gov", `Bearer ${secret}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false, runId: 42,
      fetch: { source: "tech-jobs-for-gov", ok: false, seen: 0, new: 0, error: "Tech Jobs for Gov API: HTTP 503" },
    });
  });

  it("answers 500 when the run itself throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchAndSaveSource.mockRejectedValue(new Error("database unreachable"));
    const response = await cronRequest("tech-jobs-for-gov", `Bearer ${secret}`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "The job fetch failed; see the logs" });
    expect(console.error).toHaveBeenCalledWith("[daily-check] fetch-run-failed", expect.any(Error));
  });

  it.each(["unknown-board", "toString", "gemini-tagging"])("answers 404 for %s, which is not a job source", async source => {
    const response = await cronRequest(source, `Bearer ${secret}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "Unknown source" });
    expect(fetchAndSaveSource).not.toHaveBeenCalled();
  });

  it.each(["tech-jobs-for-gov", "unknown-board"])("rejects a request for %s without the cron secret", async source => {
    const response = await cronRequest(source);

    expect(response.status).toBe(401);
    expect(fetchAndSaveSource).not.toHaveBeenCalled();
  });
});
