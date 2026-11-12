import { load } from "cheerio";
import { fetchFromSource } from "./fetch-from-source";

export const DSCOVERY_SOURCE = "dscovery";
const ORIGIN = "https://dscovery.fly.dev";

/** One job row of the home page: the job's DSCovery id and the row's text and apply link. */
export interface DscoveryJob {
  id: string;
  title: string;
  employerName: string;
  applyUrl: string | null;
  practices: string[];
  location: string;
}

/** A cell's visible text on one line. */
const shownText = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Every open job on the home page. Its "All Jobs" section has one table per
 * employer, named in the table's caption; the "Highlighted Jobs" table above it
 * repeats some of those jobs and is skipped.
 */
export function readHomePageJobs(homeHtml: string): DscoveryJob[] {
  const $ = load(homeHtml);
  return $("table:has(> caption) tr[id^='job-']").toArray().map(row => {
    const cells = $(row).children("td");
    const link = cells.filter(".job-link").find("a").first();
    return {
      id: $(row).attr("id")!.slice("job-".length),
      title: shownText(link.text()),
      employerName: shownText($(row).closest("table").children("caption").text()),
      applyUrl: link.attr("href") || null,
      practices: cells.eq(2).find("a").toArray().map(practice => shownText($(practice).text())),
      location: shownText(cells.eq(3).text()),
    };
  });
}

export function mapDscoveryListing(job: DscoveryJob) {
  if (!/^\d+$/.test(job.id) || !job.title) throw new Error("Invalid DSCovery listing");
  return {
    source: DSCOVERY_SOURCE,
    sourceJobId: job.id,
    title: job.title,
    employerName: job.employerName || null,
    location: job.location === "Unknown" ? null : job.location || null,
    salary: null,
    // The board shows no description; its practice tags are its only text about the work.
    description: job.practices.length ? `Practice: ${job.practices.join(", ")}` : "",
    applyUrl: job.applyUrl,
    sourceUrl: `${ORIGIN}/jobs/${job.id}/`,
    // The board dates a job only as roughly how long ago it found it, such as "About 3 weeks ago".
    postedAt: null,
    deadline: null,
  };
}

/** Every open job, from the home page alone; its RSS feed carries only the 50 newest. */
export async function fetchDscoveryJobs(fetcher = fetch): Promise<DscoveryJob[]> {
  const response = await fetchFromSource("DSCovery home page", `${ORIGIN}/`, fetcher);
  return readHomePageJobs(await response.text());
}
