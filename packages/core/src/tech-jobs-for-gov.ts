import { load } from "cheerio";

export const GOV_SOURCE = "tech-jobs-for-gov";
const API = "https://civicworkstudio.com/wp-json/wp/v2/job-listings";

export interface GovRecord {
  id: number;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
  date_gmt?: string;
  _company_name?: string | null;
  _job_location?: string | null;
  _job_salary?: string | null;
  _job_expires?: string | null;
  meta?: { _application?: string };
}

function descriptionText(html: string): string {
  const $ = load(html);
  $("script, style").remove();
  $("p, br, li, h1, h2, h3, h4, div").append("\n");
  return $.root().text().replace(/[ \t]+/g, " ").replace(/ *\n\s*/g, "\n").trim();
}

/** Pure mapping and new-job decision; saved fallback links survive later checks. */
export function planGovJob(record: GovRecord, previous?: { applyUrl: string | null }) {
  if (!Number.isInteger(record.id) || !record.link || !record.title?.rendered ||
      typeof record.content?.rendered !== "string") {
    throw new Error("Invalid Tech Jobs for Gov listing");
  }
  const applyUrl = record.meta?._application || previous?.applyUrl || null;
  return {
    isNew: !previous,
    needsPage: !previous && !applyUrl,
    job: {
      source: GOV_SOURCE,
      sourceJobId: String(record.id),
      title: descriptionText(record.title.rendered),
      employerName: record._company_name ?? null,
      location: record._job_location ?? null,
      salary: record._job_salary ?? null,
      description: descriptionText(record.content.rendered),
      applyUrl,
      sourceUrl: record.link,
      postedAt: record.date_gmt ? new Date(`${record.date_gmt}Z`) : null,
      deadline: record._job_expires || null,
    },
  };
}

export function govPageApplyLink(html: string): string | null {
  const $ = load(html);
  return $("a.cws-apply-button, a.application_button").attr("href") || null;
}

export async function fetchGovRecords(fetcher = fetch): Promise<GovRecord[]> {
  const records: GovRecord[] = [];
  let pages = 1;
  for (let page = 1; page <= pages; page++) {
    const response = await fetcher(`${API}?per_page=100&page=${page}&orderby=id&order=asc&_fields=id,link,title,content,date_gmt,_company_name,_job_location,_job_salary,_job_expires,meta`, {
      signal: AbortSignal.timeout(20_000), cache: "no-store",
    });
    if (!response.ok) throw new Error(`Tech Jobs for Gov API: HTTP ${response.status}`);
    pages = Number(response.headers.get("x-wp-totalpages") ?? 1);
    if (!Number.isInteger(pages) || pages < 0) throw new Error("Invalid API page count");
    const batch: unknown = await response.json();
    if (!Array.isArray(batch)) throw new Error("Expected Tech Jobs for Gov listings array");
    records.push(...batch as GovRecord[]);
  }
  return records;
}

export async function fetchGovApplyLink(url: string, fetcher = fetch) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Tech Jobs for Gov page: HTTP ${response.status}`);
  return govPageApplyLink(await response.text());
}
