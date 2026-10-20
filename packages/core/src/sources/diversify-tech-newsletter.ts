import { HTMLElement, parse } from "node-html-parser";
import { parseRss } from "../feeds";
import type { NormalizedJob, SourceAdapter } from "../jobs";
import { parseRemoteType } from "../location";
import { parseSalaryText } from "../salary";
import { cleanText } from "../text";
import { normalizeUrl } from "../urls";
import { NEWSLETTER_WINDOW_DAYS } from "./shared";

// The newsletter's public beehiiv RSS feed, with each issue's full HTML.
const FEED_URL = "https://rss.beehiiv.com/feeds/C62C2GAygE.xml";

export const FROM_JOB_BOARD = "job board";
export const AROUND_THE_WEB = "around the web";

/**
 * Diversify Tech's weekly newsletter. Its JOBS section has two lists of one
 * job per line, `<a>Title</a>, Employer, Location[, $min-$max]`:
 * "From our job board" (links to the board's own jobs, which the board
 * adapter also finds) and "From around the web" (jobs elsewhere, grouped
 * under plain-text headings such as "Data" or "Design"). Each job is labelled
 * with the list it came from.
 *
 * Every check reads the issues of the last few weeks, so a missed day loses
 * nothing; a job is keyed by its link, so a repeat in a later issue is the
 * same job.
 */
export const diversifyTechNewsletter: SourceAdapter = {
  id: "diversify-tech-newsletter",
  name: "Diversify Tech (newsletter)",
  sharedSourceUrls: true,
  async fetchJobs(context) {
    const response = await context.http.get(FEED_URL);
    const since = context.now.getTime() - NEWSLETTER_WINDOW_DAYS * 86_400_000;
    const jobs = new Map<string, NormalizedJob>();
    for (const issue of parseRss(response.body)) {
      const html = issue.content ?? issue.description;
      if (!html || !issue.link || (issue.publishedAt && issue.publishedAt.getTime() < since)) {
        continue;
      }
      for (const job of parseIssue(html, issue.link, issue.publishedAt)) {
        if (!jobs.has(job.externalId)) {
          jobs.set(job.externalId, job);
        }
      }
    }
    return { jobs: [...jobs.values()], listedIds: null, partial: false };
  },
};

export function parseIssue(html: string, issueUrl: string, publishedAt: Date | null): NormalizedJob[] {
  const root = parse(html);
  const jobs: NormalizedJob[] = [];
  let inJobs = false;
  let via: string | null = null;
  let group: string | null = null;
  for (const element of root.querySelectorAll("h2, h3, p")) {
    const text = cleanText(element.text) ?? "";
    if (element.tagName === "H2") {
      inJobs = /^jobs$/i.test(text);
      via = null;
      continue;
    }
    if (!inJobs) {
      continue;
    }
    if (element.tagName === "H3") {
      via = /job board/i.test(text) ? FROM_JOB_BOARD : /around the web/i.test(text) ? AROUND_THE_WEB : null;
      group = null;
      continue;
    }
    if (!via) {
      continue;
    }
    const link = element.querySelector("a");
    if (!link) {
      // A plain paragraph between the lists is a group heading, such as "Data".
      if (via === AROUND_THE_WEB && text.length <= 40) {
        group = text;
      }
      continue;
    }
    if (element.parentNode instanceof HTMLElement && element.parentNode.tagName !== "LI") {
      continue;
    }
    const job = parseJobLine(element, link, issueUrl, publishedAt, via, group);
    if (job) {
      jobs.push(job);
    }
  }
  return jobs;
}

function parseJobLine(
  line: HTMLElement,
  link: HTMLElement,
  issueUrl: string,
  publishedAt: Date | null,
  via: string,
  group: string | null,
): NormalizedJob | null {
  const href = link.getAttribute("href")?.trim();
  const title = cleanText(link.text);
  const externalId = normalizeUrl(href);
  if (!href || !title || !externalId) {
    return null;
  }
  const rest = line.text.slice(line.text.indexOf(link.text) + link.text.length);
  // Split on ", " but not inside "$200,000-$250,000".
  const parts = rest.split(/,\s+/).map((part) => part.trim()).filter(Boolean);
  const salaryPart = parts.length > 1 && /^[$£€]/.test(parts[parts.length - 1]!) ? parts.pop()! : null;
  const orgName = parts.shift() ?? null;
  const location = parts.length > 0 ? parts.join(", ") : null;

  return {
    externalId,
    sourceUrl: issueUrl,
    title,
    orgName,
    orgWebsite: null,
    location,
    remoteType: parseRemoteType(location),
    salary: parseSalaryText(salaryPart),
    description: null,
    applyUrl: href,
    postedAt: publishedAt,
    expiresAt: null,
    boardTags: group ? [{ axis: "section", tag: group }] : [],
    via,
  };
}
