import { load } from "cheerio";
import { dayDate } from "./day-date";
import { fetchFromSource, fetchPageTexts } from "./fetch-from-source";
import { htmlText } from "./html-text";
import { pause } from "./pause";

export const TJFG_SOURCE = "tech-jobs-for-good";
// The free job list, 30 jobs a page. Premium jobs are not on it and are never requested.
const JOB_LIST = "https://techjobsforgood.com/jobs/";
/** robots.txt sets no crawl delay; one request a second keeps the check polite. */
const REQUEST_DELAY_MS = 1_000;
/** The id in a job page link, e.g. `/jobs/37445/?ref=homepage`. */
const JOB_LINK = /^\/jobs\/(\d+)\//;
/** The Apply button's script opens the employer's application page, or an email to them. */
const APPLY_SCRIPT = /window\.open\('((?:https?:\/\/|mailto:)[^']+)'/;

/** What a job page shows: its JobPosting data, plus the board's displayed text and apply link. */
export interface TjfgJob {
  posting: {
    title?: string;
    hiringOrganization?: { name?: string | null } | null;
    description?: string | null;
    datePosted?: string | null;
  };
  location: string | null;
  salary: string | null;
  deadline: string | null;
  applyUrl: string | null;
}

export interface TjfgJobPage {
  id: string;
  job: TjfgJob;
}

const jobPageUrl = (id: string) => `${JOB_LIST}${id}/`;

/** The ids of the jobs a page of the free job list shows. */
export function readFreeJobIds(listHtml: string): string[] {
  const $ = load(listHtml);
  return $(".job-card .job-card-view-button").toArray()
    .map(link => JOB_LINK.exec($(link).attr("href") ?? "")?.[1])
    .filter(id => id !== undefined);
}

/** How many pages the free job list has, from the first page's page links. */
export function readJobListPageCount(listHtml: string): number {
  const $ = load(listHtml);
  const pages = $(".pagination [onclick]").toArray()
    .map(button => Number(/[?&]page=(\d+)/.exec($(button).attr("onclick") ?? "")?.[1] ?? 1));
  return Math.max(1, ...pages);
}

/** A page's visible text on one line. */
const shownText = (text: string) => text.replace(/\s+/g, " ").trim() || null;

/** What a job page shows; see TjfgJob. */
export function readJobPage(pageHtml: string): TjfgJob {
  const $ = load(pageHtml);
  const postingJson = $('script[type="application/ld+json"]').first().text();
  if (!postingJson) throw new Error("Tech Jobs for Good job page has no JobPosting data");
  const deadlineText = $("span").not('[itemprop="description"], [itemprop="description"] span').toArray()
    .map(span => $(span).text().trim())
    .find(text => text.startsWith("Application deadline:"));
  return {
    posting: JSON.parse(postingJson) as TjfgJob["posting"],
    location: shownText($('[itemprop="jobLocation"]').first().text()),
    salary: shownText($(".ui.green.basic.label").first().text()),
    deadline: shownText(deadlineText?.slice("Application deadline:".length) ?? ""),
    applyUrl: APPLY_SCRIPT.exec(pageHtml)?.[1] ?? null,
  };
}

export function mapTjfgListing({ id, job }: TjfgJobPage) {
  const { posting } = job;
  if (!/^\d+$/.test(id) || !posting.title) throw new Error("Invalid Tech Jobs for Good listing");
  return {
    source: TJFG_SOURCE,
    sourceJobId: id,
    title: posting.title,
    employerName: posting.hiringOrganization?.name || null,
    location: job.location,
    salary: job.salary,
    description: htmlText(posting.description ?? ""),
    applyUrl: job.applyUrl,
    sourceUrl: jobPageUrl(id),
    postedAt: dayDate(posting.datePosted),
    deadline: job.deadline,
  };
}

/** Every job on the free job list: its pages, then each job's page, one request a second. */
export async function fetchTjfgJobPages(fetcher = fetch, sleep = pause): Promise<TjfgJobPage[]> {
  const firstPage = await (await fetchFromSource("Tech Jobs for Good job list", JOB_LIST, fetcher)).text();
  const laterPageUrls = Array.from({ length: readJobListPageCount(firstPage) - 1 }, (_, index) => `${JOB_LIST}?page=${index + 2}`);
  const laterPages = await fetchPageTexts("Tech Jobs for Good job list", laterPageUrls, REQUEST_DELAY_MS, fetcher, sleep);
  // A job posted between page requests shifts the list, so a job can show on two pages.
  const ids = [...new Set([firstPage, ...laterPages].flatMap(readFreeJobIds))];
  const jobPages = await fetchPageTexts("Tech Jobs for Good job page", ids.map(jobPageUrl), REQUEST_DELAY_MS, fetcher, sleep);
  return ids.map((id, index) => ({ id, job: readJobPage(jobPages[index]!) }));
}
