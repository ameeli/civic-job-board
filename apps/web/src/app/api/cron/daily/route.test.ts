import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runDailyCheck, after } = vi.hoisted(() => ({
  runDailyCheck: vi.fn(),
  after: vi.fn(),
}));

vi.mock("@/lib/daily-check", () => ({ runDailyCheck }));
vi.mock("@/lib/db", () => ({ getDb: () => "fake-db" }));
vi.mock("next/server", () => ({ after }));

import { GET } from "./route";

// The route's MAX_CHAINED_RUNS.
const MAX_CHAINED_RUNS = 10;

const secret = "test-cron-secret";

function cronRequest(authorization?: string, path = "/api/cron/daily"): Request {
  return new Request(`https://board.example${path}`, {
    headers: authorization ? { authorization } : {},
  });
}

function summary(overrides = {}) {
  return {
    status: "done",
    sources: [{ source: "dscovery", ok: true, seen: 3, new: 1, partial: false }],
    closed: 0,
    reopened: 0,
    trimmedPageCopies: 0,
    ai: { tagged: 1, failed: 0, stopped: null },
    moreWork: false,
    ...overrides,
  };
}

describe("GET /api/cron/daily", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", secret);
    vi.stubEnv("GEMINI_API_KEY", "gemini-key");
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    runDailyCheck.mockResolvedValue(summary());
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    runDailyCheck.mockReset();
    after.mockReset();
    fetchMock.mockReset();
  });

  it("runs the daily check and returns its summary", async () => {
    const response = await GET(cronRequest(`Bearer ${secret}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, ...summary() });
    expect(runDailyCheck).toHaveBeenCalledWith(
      expect.objectContaining({ db: "fake-db", geminiApiKey: "gemini-key" }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs without AI when GEMINI_API_KEY is unset", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");

    await GET(cronRequest(`Bearer ${secret}`));

    expect(runDailyCheck).toHaveBeenCalledWith(expect.objectContaining({ geminiApiKey: undefined }));
  });

  it("starts a chained run with the secret when work is left", async () => {
    runDailyCheck.mockResolvedValue(summary({ moreWork: true }));

    await GET(cronRequest(`Bearer ${secret}`));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://board.example/api/cron/daily?chain=1",
      expect.objectContaining({ headers: { authorization: `Bearer ${secret}` } }),
    );
  });

  it("answers a chained run at once and works after responding", async () => {
    runDailyCheck.mockResolvedValue(summary({ moreWork: true }));

    const response = await GET(cronRequest(`Bearer ${secret}`, "/api/cron/daily?chain=2"));

    expect(response.status).toBe(202);
    expect(runDailyCheck).not.toHaveBeenCalled();
    await after.mock.calls[0]![0]();
    expect(runDailyCheck).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("https://board.example/api/cron/daily?chain=3", expect.anything());
  });

  it("stops chaining after the limit", async () => {
    runDailyCheck.mockResolvedValue(summary({ moreWork: true }));

    await GET(cronRequest(`Bearer ${secret}`, `/api/cron/daily?chain=${MAX_CHAINED_RUNS}`));
    await after.mock.calls[0]![0]();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a request without the cron secret", async () => {
    const response = await GET(cronRequest());

    expect(response.status).toBe(401);
    expect(runDailyCheck).not.toHaveBeenCalled();
  });

  it("rejects every request when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const response = await GET(cronRequest("Bearer "));

    expect(response.status).toBe(401);
    expect(runDailyCheck).not.toHaveBeenCalled();
  });
});
