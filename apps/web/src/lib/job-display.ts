import { CTFG_SOURCE } from "@civic-job-board/core/civic-tech-field-guide";
import { DSCOVERY_SOURCE } from "@civic-job-board/core/dscovery";
import { FGF_SOURCE } from "@civic-job-board/core/field-guide-friday";
import { DIVERSIFY_SOURCE } from "@civic-job-board/core/diversify-tech";
import { DT_NEWSLETTER_SOURCE } from "@civic-job-board/core/diversify-tech-newsletter";
import { TJFG_SOURCE } from "@civic-job-board/core/tech-jobs-for-good";
import { GOV_SOURCE } from "@civic-job-board/core/tech-jobs-for-gov";
import type { JobSource } from "./daily-check";

const SOURCE_NAMES: Record<JobSource, string> = {
  [GOV_SOURCE]: "Tech Jobs for Gov",
  [CTFG_SOURCE]: "Civic Tech Field Guide",
  [FGF_SOURCE]: "Field Guide Friday",
  [DIVERSIFY_SOURCE]: "Diversify Tech",
  [TJFG_SOURCE]: "Tech Jobs for Good",
  [DSCOVERY_SOURCE]: "DSCovery",
  [DT_NEWSLETTER_SOURCE]: "Diversify Tech newsletter",
};

/** A job source's name as people know it; an unrecognized source shows as stored. */
export function sourceName(source: string): string {
  return Object.hasOwn(SOURCE_NAMES, source) ? SOURCE_NAMES[source as JobSource] : source;
}

/** Up to two initials for an employer's round badge, from the first two words. */
export function employerInitials(employerName: string): string {
  return employerName
    .split(/\s+/)
    .map(word => word.match(/[\p{L}\p{N}]/u)?.[0] ?? "")
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// Boards give most posted dates as a day (stored as that day's midnight UTC), so read them in UTC.
const postedDateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
});

/** A posted date as "Nov 20, 2026". */
export function formatPostedDate(postedAt: Date): string {
  return postedDateFormat.format(postedAt);
}
