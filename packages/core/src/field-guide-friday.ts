import { load } from "cheerio";
import { fetchFromSource } from "./fetch-from-source";

export const FGF_SOURCE = "field-guide-friday";
// Field Guide Friday's public Mailchimp archive as RSS: its 10 newest issues, newest first, each the full email.
const FEED = "https://us19.campaign-archive.com/feed?u=cdb853c4847acff0d0a09460d&id=ca5a70438b";
/** Each job is one paragraph: `💼 <a href="apply link">Title</a>, Employer<br>salary | location | Apply by MM-DD-YYYY`. */
const JOB_MARK = "💼";
const DEADLINE = /^Apply by\s+/i;

/** One job as an issue's "Open Jobs" section lists it, with the issue that listed it. */
export interface FgfJob {
  title: string;
  employer: string;
  applyUrl: string;
  /** The line under the title: salary, location, and deadline, each optional, split by `|`. */
  details: string;
  issueUrl: string;
  issueSentAt: Date;
}

/** A job is the same in every issue that lists it with the same apply link and title. */
const jobKey = (job: Pick<FgfJob, "applyUrl" | "title">) => `${job.applyUrl} ${job.title}`;
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** The jobs one issue lists; `issue` says which issue they came from. */
function readIssueJobs(issueHtml: string, issue: Pick<FgfJob, "issueUrl" | "issueSentAt">): FgfJob[] {
  const $ = load(issueHtml);
  return $("p").toArray().filter(paragraph => $(paragraph).text().trim().startsWith(JOB_MARK)).map(paragraph => {
    const link = $(paragraph).find("a").first();
    const job = { title: oneLine(link.text()), applyUrl: link.attr("href")?.trim() ?? "" };
    link.remove();
    $(paragraph).find("br").replaceWith("\n");
    const [firstLine = "", ...details] = $(paragraph).text().split("\n");
    return {
      ...job,
      employer: oneLine(firstLine.replace(JOB_MARK, "")).replace(/^,\s*/, ""),
      details: oneLine(details.join(" ")),
      ...issue,
    };
  });
}

/** Every job the feed's issues list, each once, from the oldest issue that lists it. */
export function readFeedJobs(feedXml: string): FgfJob[] {
  const $ = load(feedXml, { xml: true });
  const jobs = new Map<string, FgfJob>();
  for (const item of $("item").toArray().reverse()) {
    const issue = { issueUrl: $(item).children("link").text().trim(), issueSentAt: new Date($(item).children("pubDate").text()) };
    for (const job of readIssueJobs($(item).children("description").text(), issue)) {
      if (!jobs.has(jobKey(job))) jobs.set(jobKey(job), job);
    }
  }
  return [...jobs.values()];
}

export function mapFgfListing(job: FgfJob) {
  if (!job.title || !job.applyUrl || !job.issueUrl) throw new Error("Invalid Field Guide Friday listing");
  const details = job.details.split("|").map(part => part.trim()).filter(Boolean);
  const deadline = details.find(part => DEADLINE.test(part));
  // The location is the last part before the deadline; a salary, when given, comes first.
  const salaryAndLocation = details.filter(part => part !== deadline);
  return {
    source: FGF_SOURCE,
    sourceJobId: jobKey(job),
    title: job.title,
    employerName: job.employer || null,
    location: salaryAndLocation.at(-1) ?? null,
    salary: salaryAndLocation.length > 1 ? salaryAndLocation[0]! : null,
    description: "",
    applyUrl: job.applyUrl,
    sourceUrl: job.issueUrl,
    postedAt: Number.isNaN(job.issueSentAt.getTime()) ? null : job.issueSentAt,
    deadline: deadline?.replace(DEADLINE, "") || null,
  };
}

/** Every job the archive feed lists. */
export async function fetchFgfJobs(fetcher = fetch): Promise<FgfJob[]> {
  const feed = await (await fetchFromSource("Field Guide Friday feed", FEED, fetcher)).text();
  return readFeedJobs(feed);
}
