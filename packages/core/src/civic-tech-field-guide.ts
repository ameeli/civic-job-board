import { dayDate } from "./day-date";
import { fetchFromSource } from "./fetch-from-source";

export const CTFG_SOURCE = "civic-tech-field-guide";
// The jobs feed as JSON: the RSS feed's items with the job's fields kept apart.
// Newest first; 100 is the most one request returns.
const FEED = "https://civictech.guide/api/v1/feed.json?kind=jobs&limit=100";
const GUID_PREFIX = "civictech.guide:jobs:";

export interface CtfgFeedItem {
  guid: string;
  link?: string | null;
  added?: string | null;
  permalink?: string | null;
  data?: {
    role?: string;
    organization?: string;
    organizationSummary?: string;
    organizationType?: string;
    location?: string;
    salary?: string;
    deadline?: string;
    categories?: string[];
    issues?: string[];
  };
}

/** The board's own text that has no column of its own, one fact per line. */
function descriptionText(data: NonNullable<CtfgFeedItem["data"]>): string {
  return [
    data.organizationSummary,
    data.organizationType && `Organization type: ${data.organizationType}`,
    data.categories?.length && `Categories: ${data.categories.join(", ")}`,
    data.issues?.length && `Issues: ${data.issues.join(", ")}`,
  ].filter(Boolean).join("\n");
}

export function mapCtfgListing(item: CtfgFeedItem) {
  const sourceJobId = item.guid?.startsWith(GUID_PREFIX) ? item.guid.slice(GUID_PREFIX.length) : "";
  const { data } = item;
  if (!sourceJobId || !data?.role || !item.permalink) {
    throw new Error("Invalid Civic Tech Field Guide listing");
  }
  return {
    source: CTFG_SOURCE,
    sourceJobId,
    title: data.role,
    employerName: data.organization || null,
    location: data.location || null,
    salary: data.salary || null,
    description: descriptionText(data),
    applyUrl: item.link || null,
    sourceUrl: item.permalink,
    // The feed dates a job by the day it was added, with no time.
    postedAt: dayDate(item.added),
    deadline: data.deadline || null,
  };
}

export async function fetchCtfgFeedItems(fetcher = fetch): Promise<CtfgFeedItem[]> {
  const response = await fetchFromSource("Civic Tech Field Guide feed", FEED, fetcher);
  const feed: unknown = await response.json();
  const items = (feed as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) throw new Error("Expected a Civic Tech Field Guide items array");
  return items as CtfgFeedItem[];
}
