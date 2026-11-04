import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cronRouteHandler } from "./cron-route";

const secret = "test-cron-secret";
const failure = { logEvent: "example-run-failed", message: "The example run failed; see the logs" };

function cronRequest(authorization?: string): Request {
  return new Request("http://localhost/api/cron/example", {
    headers: authorization ? { authorization } : {},
  });
}

describe("cronRouteHandler", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", secret);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("runs the job and answers 200 with its report", async () => {
    const runJob = vi.fn().mockResolvedValue({ ok: false, example: { error: "board down" } });
    const response = await cronRouteHandler(failure, runJob)(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: false, example: { error: "board down" } });
    expect(runJob).toHaveBeenCalledOnce();
  });

  it("answers 500 with the fixed message and logs the error when the job throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const thrown = new Error("database unreachable at postgres://secret@host");
    const response = await cronRouteHandler(failure, vi.fn().mockRejectedValue(thrown))(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "The example run failed; see the logs" });
    expect(console.error).toHaveBeenCalledWith("[daily-check] example-run-failed", thrown);
  });

  it.each([
    ["without an authorization header", undefined],
    ["with the wrong secret", "Bearer wrong-secret"],
  ])("rejects a request %s", async (_case, authorization) => {
    const runJob = vi.fn();
    const response = await cronRouteHandler(failure, runJob)(cronRequest(authorization));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(runJob).not.toHaveBeenCalled();
  });

  it("rejects every request when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const runJob = vi.fn();
    const response = await cronRouteHandler(failure, runJob)(cronRequest("Bearer "));
    expect(response.status).toBe(401);
    expect(runJob).not.toHaveBeenCalled();
  });
});
