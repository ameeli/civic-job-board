import { parse } from "node-html-parser";
import { parseSitemap } from "../feeds";
import { HttpError } from "../http";
import { compactPageCopy, readJobPosting } from "../html";
import type { BoardTag, NormalizedJob, SourceAdapter, SourceContext } from "../jobs";
import { parseRemoteType } from "../location";
import { parseSalaryText } from "../salary";
import { cleanText, decodeEntities } from "../text";
import { getOptional, pastDeadline } from "./shared";

const ORIGIN = "https://techjobsforgood.com";
// A safety stop; the free listing is about four pages of 30.
const MAX_LISTING_PAGES = 20;

interface ListingCard {
  id: string;
  title: string;
  orgName: string | null;
  location: string | null;
  salaryText: string | null;
  boardTags: BoardTag[];
}

/**
 * Tech Jobs for Good, free listings only. The site shows most of its jobs
 * only to paying members, so only jobs on the public free listing
 * (`/jobs/?page=N`) are ever read; premium-only jobs are never fetched.
 *
 * - The free listing decides which jobs to take. Each new one's public page
 *   is fetched once for its description, dates, and apply link.
 * - The sitemap lists every open job, free or premium, and is used only to
 *   tell when a job has closed: a job that moves from the free listing to the
 *   premium-only list is still open.
 *
 * The site's RSS feed carries only its five newest jobs, which are always on
 * the free listing too, so it adds nothing and is not read.
 */
export const techJobsForGood: SourceAdapter = {
  id: "tech-jobs-for-good",
  name: "Tech Jobs for Good",
  async fetchJobs(context) {
    const sitemap = await context.http.get(`${ORIGIN}/sitemap.xml`);
    const listedIds = parseSitemap(sitemap.body).flatMap(({ url }) => {
      const id = url.match(/^https:\/\/techjobsforgood\.com\/jobs\/(\d+)\/?$/)?.[1];
      return id ? [id] : [];
    });

    const cards = await readFreeListing(context);
    const jobs: NormalizedJob[] = [];
    let partial = false;
    for (const card of cards) {
      if (context.known.has(card.id)) {
        continue;
      }
      if (pastDeadline(context)) {
        partial = true;
        break;
      }
      jobs.push(await withJobPage(context, card));
    }
    // A free job is open even if the sitemap has not caught up with it yet.
    const ids = new Set([...listedIds, ...cards.map(({ id }) => id)]);
    return { jobs, listedIds: [...ids], partial };
  },
};

async function readFreeListing(context: SourceContext): Promise<ListingCard[]> {
  const cards = new Map<string, ListingCard>();
  for (let page = 1; page <= MAX_LISTING_PAGES; page++) {
    let body: string;
    try {
      body = (await context.http.get(`${ORIGIN}/jobs/?page=${page}`)).body;
    } catch (error) {
      // The page after the last one is a 404.
      if (page > 1 && error instanceof HttpError && error.status === 404) {
        break;
      }
      throw error;
    }
    const found = parseListingPage(body);
    if (found.length === 0) {
      break;
    }
    for (const card of found) {
      cards.set(card.id, card);
    }
  }
  return [...cards.values()];
}

export function parseListingPage(html: string): ListingCard[] {
  const root = parse(html);
  return root.querySelectorAll(".job-card").flatMap((card) => {
    const link = card.querySelector('a[href^="/jobs/"]');
    const id = link?.getAttribute("href")?.match(/^\/jobs\/(\d+)\//)?.[1];
    const title = cleanText(card.querySelector(".job-title")?.text);
    if (!id || !title) {
      return [];
    }
    const boardTags = card.querySelectorAll(".extra.content .ui.label").flatMap((label) => {
      const tag = cleanText(label.text);
      if (!tag) {
        return [];
      }
      // The violet label is the job function; the others are impact areas.
      return [{ axis: label.classList.contains("violet") ? "job_function" : "impact_area", tag }];
    });
    return [{
      id,
      title,
      orgName: cleanText(card.querySelector(".company_name")?.text),
      location: cleanText(card.querySelector(".location")?.text),
      salaryText: cleanText(card.querySelector(".salary")?.text),
      boardTags,
    }];
  });
}

async function withJobPage(context: SourceContext, card: ListingCard): Promise<NormalizedJob> {
  const sourceUrl = `${ORIGIN}/jobs/${card.id}/`;
  const job: NormalizedJob = {
    externalId: card.id,
    sourceUrl,
    title: card.title,
    orgName: card.orgName,
    orgWebsite: null,
    location: card.location,
    remoteType: parseRemoteType(card.location),
    salary: parseSalaryText(card.salaryText),
    description: null,
    applyUrl: null,
    postedAt: null,
    expiresAt: null,
    boardTags: card.boardTags,
  };
  const page = await getOptional(context, sourceUrl);
  const posting = page ? readJobPosting(page.body) : null;
  if (!page || !posting) {
    return job;
  }
  // The Apply button's click handler opens the employer's page: window.open('URL', ...).
  const applyUrl = page.body.match(
    /#apply-for-job"\)\.on\([\s\S]*?window\.open\('(https?:\/\/[^']+)'/,
  )?.[1];
  return {
    ...job,
    orgName: job.orgName ?? posting.orgName,
    orgWebsite: posting.orgWebsite,
    location: job.location ?? posting.location,
    remoteType: job.remoteType ?? posting.remoteType,
    salary: posting.salary ?? job.salary,
    description: posting.description,
    applyUrl: applyUrl ? decodeEntities(applyUrl) : null,
    postedAt: posting.postedAt,
    expiresAt: posting.expiresAt,
    page: { url: page.url, html: compactPageCopy(page.body) },
  };
}
