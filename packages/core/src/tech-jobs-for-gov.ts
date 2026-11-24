import { decodeHTML } from "entities";
import { fetchFromSource } from "./fetch-from-source";
import { htmlText } from "./html-text";

export const GOV_SOURCE = "tech-jobs-for-gov";
const API = "https://civicworkstudio.com/wp-json/wp/v2/job-listings";
const META_FIELDS = "meta._company_name,meta._job_location,meta._job_salary,meta._application";

export interface GovRecord {
  id: number;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
  date_gmt?: string;
  meta?: { _company_name?: string; _job_location?: string; _job_salary?: string; _application?: string };
}

export function mapGovListing(record: GovRecord) {
  if (!Number.isInteger(record.id) || !record.link || !record.title?.rendered ||
      typeof record.content?.rendered !== "string") {
    throw new Error("Invalid Tech Jobs for Gov listing");
  }
  const meta = record.meta ?? {};
  const applyUrl = meta._application ? decodeHTML(meta._application) : null;
  return {
    source: GOV_SOURCE,
    sourceJobId: String(record.id),
    title: htmlText(record.title.rendered),
    employerName: meta._company_name || null,
    location: meta._job_location || null,
    salary: meta._job_salary || null,
    description: htmlText(record.content.rendered),
    applyUrl,
    sourceUrl: record.link,
    postedAt: record.date_gmt ? new Date(`${record.date_gmt}Z`) : null,
    deadline: null, // The API stopped publishing _job_expires.
  };
}

export async function fetchGovRecords(fetcher = fetch): Promise<GovRecord[]> {
  const records: GovRecord[] = [];
  let pages = 1;
  for (let page = 1; page <= pages; page++) {
    const response = await fetchFromSource(
      "Tech Jobs for Gov API",
      `${API}?per_page=100&page=${page}&orderby=id&order=asc&_fields=id,link,title,content,date_gmt,${META_FIELDS}`,
      fetcher,
    );
    pages = Number(response.headers.get("x-wp-totalpages") ?? 1);
    if (!Number.isInteger(pages) || pages < 0) throw new Error("Invalid API page count");
    const batch: unknown = await response.json();
    if (!Array.isArray(batch)) throw new Error("Expected Tech Jobs for Gov listings array");
    records.push(...batch as GovRecord[]);
  }
  return records;
}
