import { describe, expect, it } from "vitest";
import { isAllowedEmail } from "./allowlist";

describe("isAllowedEmail", () => {
  const allowed = "owner@gmail.com";

  it("accepts the allowed address", () => {
    expect(isAllowedEmail("owner@gmail.com", allowed)).toBe(true);
  });

  it("ignores case on both sides", () => {
    expect(isAllowedEmail("Owner@Gmail.COM", allowed)).toBe(true);
    expect(isAllowedEmail("owner@gmail.com", "OWNER@gmail.com")).toBe(true);
  });

  it("ignores surrounding whitespace in the configured address", () => {
    expect(isAllowedEmail("owner@gmail.com", "  owner@gmail.com\n")).toBe(true);
  });

  it("rejects any other address", () => {
    expect(isAllowedEmail("someone@gmail.com", allowed)).toBe(false);
    expect(isAllowedEmail("owner@gmail.com.evil.com", allowed)).toBe(false);
    expect(isAllowedEmail("xowner@gmail.com", allowed)).toBe(false);
  });

  it("rejects a missing address", () => {
    expect(isAllowedEmail(null, allowed)).toBe(false);
    expect(isAllowedEmail(undefined, allowed)).toBe(false);
    expect(isAllowedEmail("", allowed)).toBe(false);
  });

  it("rejects everything when no address is configured", () => {
    expect(isAllowedEmail("owner@gmail.com", undefined)).toBe(false);
    expect(isAllowedEmail("owner@gmail.com", "")).toBe(false);
    expect(isAllowedEmail("", "  ")).toBe(false);
  });
});
