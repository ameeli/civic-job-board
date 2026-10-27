import { parse } from "node-html-parser";
import { parseRss } from "../feeds";
import type { NormalizedJob, SourceAdapter } from "../jobs";
import { parseRemoteType } from "../location";
import { cleanText } from "../text";
import { linkExternalId } from "../urls";
import { pastDeadline, withApplyPage } from "./shared";

const ORIGIN = "https://dscovery.fly.dev";

/**
 * DSCovery, which gathers jobs from the career pages of Digital Services
 * Coalition member firms (civic tech government contractors).
 *
 * Its RSS feed (`/feed/jobs`) carries only the 50 newest jobs, as
 * "Employer: Title" plus the application link. Its home page lists every
 * open job in a table with the employer, the firm's practice area, and
 * location, so the table is the full listing (and tells when a job closes)
 * and the feed is merged in. A job is keyed by its application link (plus its
 * title when the link is a shared careers page), the one id both share. Each new job's application page is fetched once for its
 * description.
 */
export const dscovery: SourceAdapter = {
  id: "dscovery",
  name: "DSCovery",
  async fetchJobs(context) {
    const [home, feed] = await Promise.all([
      context.http.get(`${ORIGIN}/`),
      context.http.get(`${ORIGIN}/feed/jobs`),
    ]);
    const listing = new Map<string, NormalizedJob>();
    for (const job of parseHomeTable(home.body, context.now)) {
      listing.set(job.externalId, job);
    }
    for (const item of parseRss(feed.body)) {
      const [orgName, title] = splitFeedTitle(item.title ?? "");
      const externalId = title ? linkExternalId(item.link, title) : null;
      if (externalId && title && !listing.has(externalId)) {
        listing.set(externalId, emptyJob(externalId, item.link!, title, orgName));
      }
    }

    const jobs: NormalizedJob[] = [];
    let partial = false;
    for (const job of listing.values()) {
      if (context.known.has(job.externalId)) {
        jobs.push(job);
      } else if (pastDeadline(context)) {
        partial = true;
      } else {
        jobs.push(await withApplyPage(context, job));
      }
    }
    return { jobs, listedIds: [...listing.keys()], partial };
  },
};

export function parseHomeTable(html: string, now: Date): NormalizedJob[] {
  const root = parse(html);
  // A "Highlighted Jobs" table names the employer in each row's first cell;
  // then "All Jobs" has one table per employer, named in its <caption>.
  // Highlighted jobs appear in both.
  const jobs = new Map<string, NormalizedJob>();
  for (const row of root.querySelectorAll('tr[id^="job-"]')) {
    const cells = row.querySelectorAll("td");
    const link = row.querySelector("td.job-link a");
    const href = link?.getAttribute("href")?.trim();
    const title = cleanText(link?.text);
    const externalId = title ? linkExternalId(href, title) : null;
    if (!href || !externalId || !title || cells.length < 5) {
      continue;
    }
    const caption = row.closest("table")?.querySelector("caption");
    const orgName = cleanText(caption?.text) ?? cleanText(cells[0]!.querySelector("a")?.text);
    const job = emptyJob(externalId, href, title, orgName);
    job.location = cleanText(cells[3]!.text);
    job.remoteType = parseRemoteType(job.location);
    job.postedAt = parseFoundAgo(cleanText(cells[4]!.text), now);
    job.boardTags = cells[2]!
      .querySelectorAll("a")
      .flatMap((a) => (cleanText(a.text) ? [{ axis: "practice", tag: cleanText(a.text)! }] : []));
    jobs.set(externalId, job);
  }
  return [...jobs.values()];
}

function emptyJob(externalId: string, link: string, title: string, orgName: string | null): NormalizedJob {
  return {
    externalId,
    sourceUrl: link,
    title,
    orgName,
    orgWebsite: null,
    location: null,
    remoteType: null,
    salary: null,
    description: null,
    applyUrl: link,
    postedAt: null,
    expiresAt: undefined,
    boardTags: [],
  };
}

// Feed titles read "Employer: Job title"; job titles can contain colons too.
function splitFeedTitle(title: string): [string | null, string | null] {
  const at = title.indexOf(": ");
  return at > 0
    ? [cleanText(title.slice(0, at)), cleanText(title.slice(at + 2))]
    : [null, cleanText(title)];
}

const UNIT_MS: Record<string, number> = {
  minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000,
  month: 2_592_000_000, year: 31_536_000_000,
};

// "About 4 days ago", "about 1 month ago", "2 hours ago".
function parseFoundAgo(text: string | null, now: Date): Date | null {
  const match = text?.toLowerCase().match(/(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/);
  if (!match) {
    return null;
  }
  return new Date(now.getTime() - Number(match[1]) * UNIT_MS[match[2]!]!);
}
