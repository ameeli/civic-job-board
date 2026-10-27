import type { Salary, SalaryPeriod } from "./jobs";

const CURRENCY_SYMBOLS: Record<string, string> = {
  $: "USD", "US$": "USD", "£": "GBP", "€": "EUR", "C$": "CAD", "CA$": "CAD",
  "A$": "AUD", "AU$": "AUD", "₹": "INR", "¥": "JPY",
};
const CURRENCY_CODES = "USD|GBP|EUR|CAD|AUD|NZD|INR|JPY|CHF|SEK|NOK|DKK|KES|NGN|ZAR|ETB|MXN|BRL";
const CURRENCY_CODE = new RegExp(`\\b(${CURRENCY_CODES})\\b`, "i");

/**
 * Plausible pay per period in currencies of a similar scale to the dollar.
 * A figure outside its period's range is re-read with another period, or
 * dropped, so a typo or a misplaced unit never shows as real pay.
 */
const PLAUSIBLE: Record<SalaryPeriod, [number, number]> = {
  hour: [5, 1_000],
  day: [40, 5_000],
  week: [200, 25_000],
  month: [700, 120_000],
  year: [8_000, 1_500_000],
};
const DOLLAR_SCALE = new Set(["USD", "CAD", "AUD", "NZD", "GBP", "EUR", "CHF"]);

/** Maps the many ways sources write a pay period to one of ours. */
export function parsePeriod(text: string | null | undefined): SalaryPeriod | null {
  if (!text) {
    return null;
  }
  const t = text.toLowerCase();
  if (/\b(hour|hourly|hr)\b/.test(t)) return "hour";
  if (/\b(day|daily)\b/.test(t)) return "day";
  if (/\b(week|weekly|wk)\b/.test(t)) return "week";
  if (/\b(month|monthly)\b|\/\s?mo\b/.test(t)) return "month";
  if (/\b(year|yearly|annual|annually|annum|yr)\b|\bp\.a\./.test(t)) return "year";
  return null;
}

/** Parses an amount such as `121K`, `$63,200`, `129847.68`, or `1.2M`. */
export function parseAmount(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  const match = raw.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([kKmM])?/);
  if (!match) {
    return null;
  }
  const scale = match[2] ? (match[2].toLowerCase() === "k" ? 1_000 : 1_000_000) : 1;
  const value = Number(match[1]) * scale;
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Parses free-text pay such as `$121K - $175K`, `£52,973 - £69,273`,
 * `$30/hr`, or `55000`. Returns null when the text holds no amount.
 */
export function parseSalaryText(
  text: string | null | undefined,
  defaultPeriod: SalaryPeriod = "year",
): Salary | null {
  if (!text) {
    return null;
  }
  const symbol = text.match(/[A-Z]{1,2}\$|[$£€₹¥]/)?.[0];
  const currency =
    text.match(CURRENCY_CODE)?.[1]?.toUpperCase() ??
    (symbol ? (CURRENCY_SYMBOLS[symbol] ?? null) : null);
  const period = parsePeriod(text);
  const amount = String.raw`(?:[A-Z]{1,2}\$|[$£€₹¥]|\b(?:${CURRENCY_CODES})\s+)?\s?\d[\d,]*(?:\.\d+)?\s?[kKmM]?\b`;
  const values = [...text.matchAll(new RegExp(`(${amount})(?:\\s*(?:[-–—]|to)\\s*(${amount}))?`, "gi"))]
    .filter((match) =>
      /[$£€₹¥kKmM,]/.test(match[0]) ||
      (period !== null && CURRENCY_CODE.test(match[0])) ||
      Number(match[1]!.replace(/\D/g, "")) >= 1000,
    )
    .filter((match) => !/^(19|20)\d\d$/.test(match[1]!.trim()))
    .flatMap((match) => [parseAmount(match[1]), parseAmount(match[2])])
    .filter((value): value is number => value !== null);
  if (values.length === 0) {
    return null;
  }
  return sanitizeSalary({
    min: values[0]!,
    max: values.length > 1 ? values[1]! : null,
    currency,
    period: period ?? defaultPeriod,
  });
}

/**
 * Applies unit sanity checks: orders min and max, re-reads an implausible
 * yearly figure as hourly or monthly when that fits, and drops pay that fits
 * no period. Returns null when nothing usable is left.
 */
export function sanitizeSalary(salary: Salary | null): Salary | null {
  if (!salary) {
    return null;
  }
  let { min, max } = salary;
  const { currency } = salary;
  let { period } = salary;
  if (min !== null && !(min > 0)) min = null;
  if (max !== null && !(max > 0)) max = null;
  if (min === null && max === null) {
    return null;
  }
  if (min !== null && max !== null && min > max) {
    [min, max] = [max, min];
  }
  if (min !== null && max !== null && min === max) {
    max = null;
  }
  // Only check scale for currencies near the dollar's; a yen or rupee salary has other magnitudes.
  if (currency === null || DOLLAR_SCALE.has(currency)) {
    const fits = (p: SalaryPeriod) =>
      [min, max].every(
        (v) => v === null || (v >= PLAUSIBLE[p][0] && v <= PLAUSIBLE[p][1]),
      );
    if (!fits(period)) {
      const reread = (["year", "hour", "month"] as const).find(
        (p) => p !== period && fits(p),
      );
      if (!reread) {
        return null;
      }
      period = reread;
    }
  }
  return { min, max, currency, period };
}
