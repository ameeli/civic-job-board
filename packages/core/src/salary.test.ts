import { describe, expect, it } from "vitest";
import { parseSalaryText, sanitizeSalary } from "./salary";

describe("parseSalaryText", () => {
  it.each([
    ["$121K - $175K", { min: 121000, max: 175000, currency: "USD", period: "year" }],
    ["$63,200 - $80,050", { min: 63200, max: 80050, currency: "USD", period: "year" }],
    ["£52,973 - £69,273", { min: 52973, max: 69273, currency: "GBP", period: "year" }],
    ["$200,000-$250,000", { min: 200000, max: 250000, currency: "USD", period: "year" }],
    ["55000", { min: 55000, max: null, currency: null, period: "year" }],
    ["$30–45/hr", { min: 30, max: 45, currency: "USD", period: "hour" }],
    ["USD 30–45/hour", { min: 30, max: 45, currency: "USD", period: "hour" }],
    ["GBP 30 - 45 per hour", { min: 30, max: 45, currency: "GBP", period: "hour" }],
    ["€30—45/hour", { min: 30, max: 45, currency: "EUR", period: "hour" }],
    ["$45 to 30/hr", { min: 30, max: 45, currency: "USD", period: "hour" }],
    ["5 days per week, USD 30–45/hour", { min: 30, max: 45, currency: "USD", period: "hour" }],
    ["$30 - $45/hr", { min: 30, max: 45, currency: "USD", period: "hour" }],
    ["$6,500 per month", { min: 6500, max: null, currency: "USD", period: "month" }],
  ])("parses %s", (text, expected) => {
    expect(parseSalaryText(text)).toEqual(expected);
  });

  it("returns null when there is no amount", () => {
    expect(parseSalaryText("Hybrid (London, UK)")).toBeNull();
    expect(parseSalaryText("Apply by 2026-11-08")).toBeNull();
    expect(parseSalaryText(null)).toBeNull();
  });
});

describe("sanitizeSalary", () => {
  it("re-reads a small 'yearly' figure as hourly pay", () => {
    expect(sanitizeSalary({ min: 45, max: 60, currency: "USD", period: "year" })).toEqual({
      min: 45, max: 60, currency: "USD", period: "hour",
    });
  });

  it("drops pay that fits no period", () => {
    expect(sanitizeSalary({ min: 2_093_000, max: 2_898_000, currency: "USD", period: "year" })).toBeNull();
  });

  it("orders min and max and collapses equal values", () => {
    expect(sanitizeSalary({ min: 90000, max: 70000, currency: "USD", period: "year" })).toMatchObject({ min: 70000, max: 90000 });
    expect(sanitizeSalary({ min: 90000, max: 90000, currency: "USD", period: "year" })).toMatchObject({ min: 90000, max: null });
  });

  it("does not apply dollar-scale checks to other currencies", () => {
    expect(sanitizeSalary({ min: 6_000_000, max: null, currency: "JPY", period: "year" })).toMatchObject({ min: 6_000_000 });
  });
});
