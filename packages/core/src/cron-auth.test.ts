import { describe, expect, it } from "vitest";
import { isAuthorizedCronRequest } from "./cron-auth";

describe("isAuthorizedCronRequest", () => {
  const secret = "test-cron-secret";

  it("accepts the exact bearer header", () => {
    expect(isAuthorizedCronRequest(`Bearer ${secret}`, secret)).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(isAuthorizedCronRequest(null, secret)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(isAuthorizedCronRequest("Bearer wrong", secret)).toBe(false);
  });

  it("rejects the secret without the Bearer prefix", () => {
    expect(isAuthorizedCronRequest(secret, secret)).toBe(false);
  });

  it("rejects a header that only starts with the expected value", () => {
    expect(isAuthorizedCronRequest(`Bearer ${secret}x`, secret)).toBe(false);
  });

  it("rejects everything when no secret is configured", () => {
    expect(isAuthorizedCronRequest("Bearer ", "")).toBe(false);
    expect(isAuthorizedCronRequest("Bearer undefined", undefined)).toBe(false);
  });
});
