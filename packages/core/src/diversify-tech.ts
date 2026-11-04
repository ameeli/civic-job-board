import { load } from "cheerio";
import { fetchFromSource } from "./fetch-from-source";
import { htmlText } from "./html-text";
import { pause } from "./pause";

export const DIVERSIFY_SOURCE = "diversify-tech";
// Lists every live job page. The board's own job list loads from /api/, which robots.txt disallows.
const SITEMAP = "https://jobs.diversifytech.com/sitemap-jobs.xml";
const JOB_PAGE_PREFIX = "https://jobs.diversifytech.com/job/";
/** robots.txt asks for a one-second crawl delay. */
const CRAWL_DELAY_MS = 1_000;
/** Each job page embeds the board's record of the job as one line of JSON. */
const JOB_RECORD = /^\s*var job_json = (\{.*\});\s*$/m;
const SALARY_TIMEFRAMES: Record<string, string> = {
  annually: "Annually", quarterly: "Quarterly", monthly: "Monthly", weekly: "Weekly", daily: "Daily", hourly: "Hourly",
};

/** The board's record of a job: the fields the page shows that the listing keeps. */
export interface DiversifyJob {
  id: number;
  title: string;
  company?: { name?: string | null } | null;
  location_name?: string | null;
  is_remote?: boolean;
  remote_only?: boolean;
  remote_required_location?: string | null;
  salary_min?: string | null;
  salary_max?: string | null;
  salary_currency?: string | null;
  salary_timeframe?: string | null;
  description_html?: string | null;
  apply_url?: string | null;
  published_at?: string | null;
  custom_fields?: { "application-deadline"?: { value?: unknown } } | null;
}

export interface DiversifyJobPage {
  sourceUrl: string;
  job: DiversifyJob;
}

/** The job page URLs a sitemap lists; anything else on the site is skipped. */
export function readJobPageUrls(sitemapXml: string): string[] {
  const $ = load(sitemapXml, { xml: true });
  return $("url > loc").toArray().map(loc => $(loc).text().trim()).filter(url => url.startsWith(JOB_PAGE_PREFIX));
}

/** The board's record of the job a job page shows. */
export function readJobRecord(pageHtml: string): DiversifyJob {
  const json = JOB_RECORD.exec(pageHtml)?.[1];
  if (!json) throw new Error("Diversify Tech job page has no job record");
  return JSON.parse(json) as DiversifyJob;
}

/** Location as the board shows it: the place, or for remote-only jobs where applicants may be, then the remote kind. */
function locationText(job: DiversifyJob): string | null {
  const requirement = job.remote_required_location?.trim() || null;
  if (job.remote_only) return `${requirement ?? "Anywhere"} (Remote only)`;
  const place = job.location_name?.trim() || null;
  if (!job.is_remote) return place;
  const hybrid = requirement ? `Hybrid: ${requirement}` : "Hybrid";
  return place ? `${place} (${hybrid})` : hybrid;
}

/** An amount as the board writes it: thousands separated by commas, no `.00`. */
function amountText(amount: string): string {
  return amount.replace(/\B(?=(\d{3})+(?!\d))/g, ",").replace(/\.0+$/, "");
}

/**
 * Salary as the board shows it, e.g. `$228,800-308,800 (Monthly)`: amounts and
 * timeframe exactly as entered, without unit correction. The board's currency
 * is USD; a job in another currency shows its code.
 */
function salaryText(job: DiversifyJob): string | null {
  const [min, max] = [job.salary_min, job.salary_max].map(amount => amount ? amountText(amount) : null);
  const amounts = min && max ? `${min}-${max}` : min ? `${min}+` : max;
  if (!amounts) return null;
  const currency = job.salary_currency || "USD";
  const timeframe = SALARY_TIMEFRAMES[job.salary_timeframe ?? ""];
  return [currency === "USD" ? `$${amounts}` : `${currency} ${amounts}`, timeframe && `(${timeframe})`]
    .filter(Boolean).join(" ");
}

export function mapDiversifyListing({ sourceUrl, job }: DiversifyJobPage) {
  if (!Number.isInteger(job?.id) || !job.title || !sourceUrl) throw new Error("Invalid Diversify Tech listing");
  // The board's posting expiry is always 45 days out, so only the employer's own deadline is kept.
  const deadline = job.custom_fields?.["application-deadline"]?.value;
  return {
    source: DIVERSIFY_SOURCE,
    sourceJobId: String(job.id),
    title: job.title,
    employerName: job.company?.name || null,
    location: locationText(job),
    salary: salaryText(job),
    description: htmlText(job.description_html ?? ""),
    applyUrl: job.apply_url || null,
    sourceUrl,
    postedAt: job.published_at ? new Date(job.published_at) : null,
    deadline: typeof deadline === "string" && deadline.trim() ? deadline.trim() : null,
  };
}

/** Every live job page's record, one page request a second after the sitemap. */
export async function fetchDiversifyJobPages(fetcher = fetch, sleep = pause): Promise<DiversifyJobPage[]> {
  const sitemap = await fetchFromSource("Diversify Tech sitemap", SITEMAP, fetcher);
  const pages: DiversifyJobPage[] = [];
  for (const sourceUrl of readJobPageUrls(await sitemap.text())) {
    await sleep(CRAWL_DELAY_MS);
    const page = await fetchFromSource("Diversify Tech job page", sourceUrl, fetcher);
    pages.push({ sourceUrl, job: readJobRecord(await page.text()) });
  }
  return pages;
}
