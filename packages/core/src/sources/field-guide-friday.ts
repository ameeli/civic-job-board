import { HTMLElement, parse } from "node-html-parser";
import { parseRss } from "../feeds";
import type { NormalizedJob, SourceAdapter } from "../jobs";
import { parseRemoteType } from "../location";
import { parseSalaryText } from "../salary";
import { cleanText } from "../text";
import { linkExternalId } from "../urls";
import { FIELD_GUIDE_ATTRIBUTION } from "./civic-tech-field-guide";
import { NEWSLETTER_WINDOW_DAYS } from "./shared";

// The newsletter's public Mailchimp campaign archive, as RSS. Each item is a full issue.
const FEED_URL =
  "https://us19.campaign-archive.com/feed?u=cdb853c4847acff0d0a09460d&id=ca5a70438b";

/**
 * Field Guide Friday, the Civic Tech Field Guide's weekly newsletter. Its
 * "Open Jobs" section lists hand-picked jobs, some of which never appear in
 * the Field Guide's own jobs feed, as one paragraph each:
 *
 *     💼 <a href="APPLY URL">Title</a>, Employer
 *     $min - $max | Location | Apply by MM-DD-YYYY
 *
 * Every check reads the issues of the last few weeks, so a missed day loses
 * nothing; a job is keyed by its apply link (plus its title when the link is a
 * shared careers page), so it is the same job in every issue that repeats it.
 */
export const fieldGuideFriday: SourceAdapter = {
  id: "field-guide-friday",
  name: "Field Guide Friday (newsletter)",
  sharedSourceUrls: true,
  attribution: FIELD_GUIDE_ATTRIBUTION,
  async fetchJobs(context) {
    const response = await context.http.get(FEED_URL);
    const since = context.now.getTime() - NEWSLETTER_WINDOW_DAYS * 86_400_000;
    const jobs = new Map<string, NormalizedJob>();
    for (const issue of parseRss(response.body)) {
      const html = issue.description ?? issue.content;
      if (!html || !issue.link || (issue.publishedAt && issue.publishedAt.getTime() < since)) {
        continue;
      }
      for (const job of parseIssue(html, issue.link, issue.publishedAt)) {
        // Issues come newest first; keep the newest mention of a job.
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
  for (const element of root.querySelectorAll("h1, h2, p")) {
    if (element.tagName !== "P") {
      inJobs = /open jobs/i.test(element.text);
      continue;
    }
    if (!inJobs || !element.text.includes("💼")) {
      continue;
    }
    const job = parseJobParagraph(element, issueUrl, publishedAt);
    if (job) {
      jobs.push(job);
    }
  }
  return jobs;
}

function parseJobParagraph(
  paragraph: HTMLElement,
  issueUrl: string,
  publishedAt: Date | null,
): NormalizedJob | null {
  const link = paragraph.querySelector("a");
  const applyUrl = link?.getAttribute("href")?.trim();
  const title = cleanText(link?.text);
  const externalId = title ? linkExternalId(applyUrl, title) : null;
  if (!link || !applyUrl || !title || !externalId) {
    return null;
  }
  // Split the paragraph at its <br>: the first line is "Title, Employer", the second the details.
  const [firstLine = "", details = ""] = paragraph.innerHTML
    .split(/<br\s*\/?>/i)
    .map((part) => parse(part).text);
  const orgName = withoutAside(
    cleanText(firstLine.slice(firstLine.indexOf(link.text) + link.text.length).replace(/^\s*,/, "")),
  );
  const parts = details.split("|").map((part) => part.trim()).filter(Boolean);
  const applyBy = parts.find((part) => /^apply by\b/i.test(part));
  const salaryPart = parts.find((part) => part !== applyBy && /\d{2},?\d{3}|[$£€]\s?\d/.test(part));
  const location = parts.find((part) => part !== applyBy && part !== salaryPart) ?? null;
  const deadline = applyBy?.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);

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
    applyUrl,
    postedAt: publishedAt,
    expiresAt: deadline
      ? new Date(Date.UTC(Number(deadline[3]), Number(deadline[1]) - 1, Number(deadline[2])))
      : null,
    boardTags: [],
  };
}

// Drops a trailing remark such as "Superbloom (our fiscal sponsor!!)", but keeps "(UCLA)".
function withoutAside(name: string | null): string | null {
  return name?.replace(/\s*\((?=[^)]*\b[a-z]{3,})[^)]*\)\s*$/, "").trim() || name;
}
