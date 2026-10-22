import { parseRss } from "../feeds";
import { parseDate } from "../html";
import type { NormalizedJob, SourceAdapter } from "../jobs";
import { parseRemoteType } from "../location";
import { parseSalaryText } from "../salary";
import { cleanText, htmlToText } from "../text";
import { pastDeadline, withApplyPage } from "./shared";

export const FIELD_GUIDE_ATTRIBUTION = {
  text: "Job data from the Civic Tech Field Guide, licensed CC BY 4.0",
  url: "https://civictech.guide",
};

const FEED_URL = "https://civictech.guide/api/v1/feed.xml?kind=jobs&limit=100";

/**
 * The Civic Tech Field Guide's jobs feed: the 100 newest jobs, each linking
 * straight to its application page. The feed has no employer field, so for
 * each new job the application page is fetched once and its schema.org
 * `JobPosting` supplies the employer, description, and dates when it has
 * them; failing that, a title such as "Data Scientist at Candid" names the
 * employer. Jobs whose employer is still unknown are matched to a known
 * employer by their ATS account during ingest, or named by the AI step.
 *
 * The feed only shows recent jobs, so it cannot tell when a job closes.
 */
export const civicTechFieldGuide: SourceAdapter = {
  id: "civic-tech-field-guide",
  name: "Civic Tech Field Guide",
  attribution: FIELD_GUIDE_ATTRIBUTION,
  async fetchJobs(context) {
    const response = await context.http.get(FEED_URL);
    const jobs: NormalizedJob[] = [];
    let partial = false;
    for (const item of parseRss(response.body)) {
      const externalId = item.guid?.replace(/^civictech\.guide:jobs:/, "");
      if (!externalId || !item.title || !item.link) {
        continue;
      }
      const job = fromFeedItem(externalId, item.title, item.link, item.description, item.publishedAt);
      if (context.known.has(externalId)) {
        // Keeps the employer stored when the job was new, which may have come from its apply page.
        jobs.push({ ...job, orgName: null });
      } else if (pastDeadline(context)) {
        partial = true;
      } else {
        // The employer the title names stands in only when the apply page names none.
        const enriched = await withApplyPage(context, { ...job, orgName: null });
        jobs.push({ ...enriched, orgName: enriched.orgName ?? job.orgName });
      }
    }
    return { jobs, listedIds: null, partial };
  },
};

function fromFeedItem(
  externalId: string,
  title: string,
  link: string,
  description: string | null,
  publishedAt: Date | null,
): NormalizedJob {
  // The description is one line: "Location · $min - $max · Apply by YYYY-MM-DD", each part optional.
  const parts = (description ? htmlToText(description) : "")
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean);
  const applyBy = parts.find((part) => /^apply by\b/i.test(part));
  const salaryPart = parts.find((part) => part !== applyBy && /\d/.test(part) && /[$£€]|\d{2},?\d{3}/.test(part));
  const location = parts.find((part) => part !== applyBy && part !== salaryPart) ?? null;
  const named = splitTitleAtEmployer(cleanText(title) ?? title);
  return {
    externalId,
    sourceUrl: link,
    title: named.title,
    orgName: named.orgName,
    orgWebsite: null,
    location,
    remoteType: parseRemoteType(location),
    salary: parseSalaryText(salaryPart),
    description: null,
    applyUrl: link,
    postedAt: publishedAt,
    expiresAt: parseDate(applyBy?.match(/\d{4}-\d{2}-\d{2}/)?.[0]) ?? undefined,
    boardTags: [],
  };
}

/**
 * Many feed titles name the employer: "Data Scientist at Candid". Splits at
 * the last " at " when what follows looks like a name (capitalized, at most
 * eight words); otherwise the title is kept whole.
 */
export function splitTitleAtEmployer(title: string): { title: string; orgName: string | null } {
  const at = title.lastIndexOf(" at ");
  if (at <= 0) {
    return { title, orgName: null };
  }
  const orgName = title.slice(at + 4).trim();
  if (!/^[\p{Lu}\d]/u.test(orgName) || orgName.split(/\s+/).length > 8) {
    return { title, orgName: null };
  }
  return { title: title.slice(0, at).trim(), orgName };
}
