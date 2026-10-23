import type { SourceAdapter } from "../jobs";
import { civicTechFieldGuide } from "./civic-tech-field-guide";
import { DIVERSIFY_TECH_HOST_DELAY, diversifyTech } from "./diversify-tech";
import { diversifyTechNewsletter } from "./diversify-tech-newsletter";
import { dscovery } from "./dscovery";
import { fieldGuideFriday } from "./field-guide-friday";
import { techJobsForGood } from "./tech-jobs-for-good";
import { techJobsForGov } from "./tech-jobs-for-gov";

/**
 * Every source the daily check polls, in the order it polls them. When
 * sources disagree about a field of one job, the earlier one wins.
 *
 * Job boards with full records come first. Field Guide Friday comes before
 * the Field Guide's own feed: the newsletter names each job's employer and
 * gives a clean title, where the feed has neither ("Title at Employer"), so
 * a feed job finds the newsletter's job by its apply link.
 */
export const SOURCES: readonly SourceAdapter[] = [
  techJobsForGov,
  techJobsForGood,
  diversifyTech,
  dscovery,
  fieldGuideFriday,
  civicTechFieldGuide,
  diversifyTechNewsletter,
];

/** Per-host gaps between requests that sources' robots.txt files ask for. */
export const SOURCE_HOST_DELAYS: Record<string, number> = {
  ...DIVERSIFY_TECH_HOST_DELAY,
};

export {
  civicTechFieldGuide,
  diversifyTech,
  diversifyTechNewsletter,
  dscovery,
  fieldGuideFriday,
  techJobsForGood,
  techJobsForGov,
};
