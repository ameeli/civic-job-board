import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tagUntaggedJobs } = vi.hoisted(() => ({ tagUntaggedJobs: vi.fn() }));

vi.mock("@/lib/daily-check", () => ({ tagUntaggedJobs }));
vi.mock("@/lib/db", () => ({ getDb: () => "fake-db" }));

import { GET } from "./route";

const secret = "test-cron-secret";

const taggingRun = { id: 43, ok: true, new: 30, defaultedToUnknown: 1, error: null };

function cronRequest(authorization?: string): Request {
  return new Request("http://localhost/api/cron/tag-jobs", {
    headers: authorization ? { authorization } : {},
  });
}

describe("GET /api/cron/tag-jobs", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", secret);
    tagUntaggedJobs.mockResolvedValue({ taggingRun, transientFailures: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    tagUntaggedJobs.mockReset();
  });

  it("tags untagged jobs and reports the tagging as ok", async () => {
    const response = await GET(cronRequest(`Bearer ${secret}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true, runId: 43, tagging: { ok: true, tagged: 30, defaulted: 1, transient: 0 },
    });
    expect(tagUntaggedJobs).toHaveBeenCalledOnce();
    expect(tagUntaggedJobs).toHaveBeenCalledWith("fake-db");
  });

  it("answers 200 with ok false when tagging fails without throwing", async () => {
    tagUntaggedJobs.mockResolvedValue({
      taggingRun: { ...taggingRun, ok: false, new: 0, defaultedToUnknown: 0, error: "Gemini: HTTP 503" },
      transientFailures: 27,
    });
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false, runId: 43, tagging: { ok: false, tagged: 0, defaulted: 0, transient: 27, error: "Gemini: HTTP 503" },
    });
  });

  it("reports skipped tagging when GEMINI_API_KEY is unset", async () => {
    tagUntaggedJobs.mockResolvedValue({
      taggingRun: { ...taggingRun, ok: false, new: 0, defaultedToUnknown: 0, error: "GEMINI_API_KEY is not set; tagging skipped" },
      transientFailures: 0,
    });
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false, runId: 43,
      tagging: { ok: false, tagged: 0, defaulted: 0, transient: 0, error: "GEMINI_API_KEY is not set; tagging skipped" },
    });
  });

  it("answers 500 when the run itself throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    tagUntaggedJobs.mockRejectedValue(new Error("database unreachable"));
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "Job tagging failed; see the logs" });
    expect(console.error).toHaveBeenCalledWith("[daily-check] tagging-run-failed", expect.any(Error));
  });

  it("rejects a request without the cron secret", async () => {
    const response = await GET(cronRequest());

    expect(response.status).toBe(401);
    expect(tagUntaggedJobs).not.toHaveBeenCalled();
  });
});
