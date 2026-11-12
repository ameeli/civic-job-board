import { load } from "cheerio";
import { fetchFromSource } from "./fetch-from-source";

export const DT_NEWSLETTER_SOURCE = "diversify-tech-newsletter";
// The weekly newsletter's public RSS feed: its last 20 issues, each with its full HTML.
const FEED = "https://rss.beehiiv.com/feeds/C62C2GAygE.xml";
/** Two weeks of issues, so a week whose issue lists no outside jobs still has the week before's. */
const ISSUE_WINDOW_MS = 14 * 86_400_000;

/**
 * One job line from an issue's "From around the web" list:
 * `<a href=link>Title</a>, Employer, Location`. The issue's
 * "From our job board" list is skipped, as the diversify-tech source saves those jobs.
 */
export interface NewsletterJob {
  issueUrl: string;
  publishedAt: Date;
  link: string;
  title: string;
  /** The line's text after the title: `, Employer, Location`. */
  details: string;
}

export interface NewsletterIssue {
  url: string;
  publishedAt: Date;
  html: string;
}

/** The feed's issues published in the two weeks up to `now`, newest first as the feed lists them. */
export function readRecentIssues(feedXml: string, now: Date): NewsletterIssue[] {
  const $ = load(feedXml, { xml: true });
  return $("item").toArray()
    .map(item => ({
      url: $(item).children("link").text().trim(),
      publishedAt: new Date($(item).children("pubDate").text()),
      html: $(item).children("content\\:encoded").text(),
    }))
    .filter(issue => now.getTime() - issue.publishedAt.getTime() <= ISSUE_WINDOW_MS);
}

/** The jobs an issue's JOBS section lists under "From around the web". */
export function readAroundTheWebJobs({ url, publishedAt, html }: NewsletterIssue): NewsletterJob[] {
  const $ = load(html);
  let section = "";
  let list = "";
  const jobs: NewsletterJob[] = [];
  for (const element of $("h2, h3, li > p").toArray()) {
    const text = $(element).text();
    if (element.tagName === "h2") [section, list] = [text.trim(), ""];
    else if (element.tagName === "h3") list = text;
    else if (section === "JOBS" && /around the web/i.test(list)) {
      const link = $(element).find("a").first();
      const href = link.attr("href");
      const title = link.text().trim();
      if (!href || !title) continue;
      jobs.push({
        issueUrl: url, publishedAt, link: href, title,
        details: text.slice(text.indexOf(link.text()) + link.text().length),
      });
    }
  }
  return jobs;
}

/** A link without the newsletter's `utm_*` tracking parameters, so a job keeps one link across issues. */
function untrackedLink(link: string): string {
  const url = new URL(link);
  for (const name of [...url.searchParams.keys()]) if (name.startsWith("utm_")) url.searchParams.delete(name);
  return url.href;
}

/**
 * A job line as a listing: the employer is the text up to the first comma and
 * the location is the rest. The line has no salary, description, or deadline.
 */
export function mapNewsletterListing({ issueUrl, publishedAt, link, title, details }: NewsletterJob) {
  const [employerName, ...location] = details.replace(/\s+/g, " ").split(",").map(part => part.trim()).filter(Boolean);
  const applyUrl = untrackedLink(link);
  return {
    source: DT_NEWSLETTER_SOURCE,
    sourceJobId: applyUrl,
    title,
    employerName: employerName ?? null,
    location: location.join(", ") || null,
    salary: null,
    description: "",
    applyUrl,
    sourceUrl: issueUrl,
    postedAt: publishedAt,
    deadline: null,
  };
}

/** The outside jobs listed by the last two weeks' issues, each once, from its newest issue. */
export async function fetchNewsletterJobs(fetcher = fetch, now = new Date()): Promise<NewsletterJob[]> {
  const feed = await (await fetchFromSource("Diversify Tech newsletter feed", FEED, fetcher)).text();
  const jobs = new Map<string, NewsletterJob>();
  for (const job of readRecentIssues(feed, now).flatMap(readAroundTheWebJobs)) {
    const key = untrackedLink(job.link);
    if (!jobs.has(key)) jobs.set(key, job);
  }
  return [...jobs.values()];
}
