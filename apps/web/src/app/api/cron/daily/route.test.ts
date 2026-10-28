import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dailyCheck } = vi.hoisted(() => ({ dailyCheck: vi.fn() }));

vi.mock("@/lib/daily-check", () => ({ dailyCheck }));
vi.mock("@/lib/db", () => ({ getDb: () => "fake-db" }));

import { GET } from "./route";

const secret = "test-cron-secret";

function cronRequest(authorization?: string): Request {
  return new Request("http://localhost/api/cron/daily", {
    headers: authorization ? { authorization } : {},
  });
}

describe("GET /api/cron/daily", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", secret);
    dailyCheck.mockResolvedValue({ id: 42, ok: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    dailyCheck.mockReset();
  });

  it("runs the daily source check", async () => {
    const response = await GET(cronRequest(`Bearer ${secret}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, runId: 42 });
    expect(dailyCheck).toHaveBeenCalledOnce();
    expect(dailyCheck).toHaveBeenCalledWith("fake-db");
  });

  it("returns an error status for a failed source check", async () => {
    dailyCheck.mockResolvedValue({ id: 43, ok: false });
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ ok: false, runId: 43 });
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
