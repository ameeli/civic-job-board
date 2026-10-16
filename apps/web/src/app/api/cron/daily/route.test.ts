import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { recordSourceRun } = vi.hoisted(() => ({ recordSourceRun: vi.fn() }));

vi.mock("@civic-job-board/db", () => ({ recordSourceRun }));
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
    recordSourceRun.mockResolvedValue({ id: 42 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    recordSourceRun.mockReset();
  });

  it("records one successful run", async () => {
    const response = await GET(cronRequest(`Bearer ${secret}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, runId: 42 });
    expect(recordSourceRun).toHaveBeenCalledOnce();
    expect(recordSourceRun).toHaveBeenCalledWith(
      "fake-db",
      expect.objectContaining({ source: "daily", ok: true }),
    );
  });

  it("rejects a request without the cron secret", async () => {
    const response = await GET(cronRequest());

    expect(response.status).toBe(401);
    expect(recordSourceRun).not.toHaveBeenCalled();
  });

  it("rejects every request when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const response = await GET(cronRequest("Bearer "));

    expect(response.status).toBe(401);
    expect(recordSourceRun).not.toHaveBeenCalled();
  });
});
