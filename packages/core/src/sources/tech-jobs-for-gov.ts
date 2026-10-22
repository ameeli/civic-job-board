import { asString, compactPageCopy, isRecord, parseDate, readJobPosting } from "../html";
import type { BoardTag, NormalizedJob, SourceAdapter, SourceContext } from "../jobs";
import { parseRemoteType } from "../location";
import { parseSalaryText } from "../salary";
import { cleanText, decodeEntities, htmlToText } from "../text";
import { getOptional, pastDeadline } from "./shared";

const API = "https://civicworkstudio.com/wp-json/wp/v2";
const PAGE_SIZE = 100;

/**
 * Tech Jobs for Gov (civicworkstudio.com), a WordPress site whose job
 * listings are public through the WordPress REST API.
 *
 * Each check lists every open job's id and last-modified time (a few small
 * requests), fetches full records only for jobs that are new or changed, and
 * fetches each of those jobs' pages once for the apply link, which the API
 * does not include. Jobs WordPress expires leave the listing.
 */
export const techJobsForGov: SourceAdapter = {
  id: "tech-jobs-for-gov",
  name: "Tech Jobs for Gov",
  async fetchJobs(context) {
    const listed = await listJobs(context);
    const changed = listed.filter(
      ({ id, modified }) => context.known.get(id)?.version !== modified,
    );
    if (changed.length === 0) {
      return { jobs: [], listedIds: listed.map(({ id }) => id), partial: false };
    }

    const [categories, types] = await Promise.all([
      termNames(context, "job-categories"),
      termNames(context, "job-types"),
    ]);
    const jobs: NormalizedJob[] = [];
    let partial = false;
    for (let i = 0; i < changed.length; i += PAGE_SIZE) {
      const ids = changed.slice(i, i + PAGE_SIZE).map(({ id }) => id);
      const response = await context.http.get(
        `${API}/job-listings?include=${ids.join(",")}&per_page=${PAGE_SIZE}`,
      );
      for (const record of JSON.parse(response.body) as unknown[]) {
        if (pastDeadline(context)) {
          partial = true;
          break;
        }
        const job = toJob(record, categories, types);
        if (job) {
          jobs.push(await withJobPage(context, job));
        }
      }
      if (partial) {
        break;
      }
    }
    return { jobs, listedIds: listed.map(({ id }) => id), partial };
  },
};

async function listJobs(context: SourceContext) {
  const listed: { id: string; modified: string }[] = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page++) {
    const response = await context.http.get(
      `${API}/job-listings?per_page=${PAGE_SIZE}&page=${page}&_fields=id,modified_gmt&orderby=id&order=asc`,
    );
    totalPages = Number(response.headers.get("x-wp-totalpages") ?? "1") || 1;
    for (const item of JSON.parse(response.body) as unknown[]) {
      if (isRecord(item) && typeof item.id === "number") {
        listed.push({ id: String(item.id), modified: String(item.modified_gmt ?? "") });
      }
    }
  }
  return listed;
}

async function termNames(context: SourceContext, taxonomy: string) {
  const response = await context.http.get(
    `${API}/${taxonomy}?per_page=100&_fields=id,name`,
  );
  const names = new Map<number, string>();
  for (const term of JSON.parse(response.body) as unknown[]) {
    if (isRecord(term) && typeof term.id === "number" && typeof term.name === "string") {
      names.set(term.id, decodeEntities(term.name));
    }
  }
  return names;
}

function toJob(
  record: unknown,
  categories: Map<number, string>,
  types: Map<number, string>,
): NormalizedJob | null {
  if (!isRecord(record) || typeof record.id !== "number") {
    return null;
  }
  const title = isRecord(record.title) ? asString(record.title.rendered) : null;
  const link = asString(record.link);
  if (!title || !link) {
    return null;
  }
  const content = isRecord(record.content) ? asString(record.content.rendered) : null;
  const flexibility = asString(record.work_flexibility);
  const location = cleanText(asString(record._job_location));

  const boardTags: BoardTag[] = [
    ...termIds(record["job-categories"]).map((id) => ({ axis: "category", tag: categories.get(id) })),
    ...termIds(record["job-types"]).map((id) => ({ axis: "job_type", tag: types.get(id) })),
    { axis: "organization_type", tag: asString(record.organization_type) ?? undefined },
  ].filter((tag): tag is BoardTag => !!tag.tag);

  const salaryText = asString(record._job_salary);
  return {
    externalId: String(record.id),
    sourceUrl: link,
    title: decodeEntities(title),
    orgName: cleanText(asString(record._company_name)),
    orgWebsite: asString(record._company_website),
    location,
    remoteType: parseRemoteType(flexibility) ?? parseRemoteType(location),
    salary: salaryText ? parseSalaryText(`$${salaryText}`) : null,
    description: content ? htmlToText(content) : null,
    applyUrl: null,
    postedAt: parseDate(gmt(asString(record.date_gmt))),
    expiresAt: record._job_expires === null ? null : parseDate(asString(record._job_expires)) ?? undefined,
    boardTags,
    version: String(record.modified_gmt ?? ""),
  };
}

// The apply link is only on the job's page, in its "View Original Posting" button.
async function withJobPage(context: SourceContext, job: NormalizedJob): Promise<NormalizedJob> {
  const page = await getOptional(context, job.sourceUrl);
  if (!page) {
    return job;
  }
  const button =
    page.body.match(/<a\s[^>]*href="([^"]+)"[^>]*class="[^"]*application_button[^"]*"/i) ??
    page.body.match(/<a\s[^>]*class="[^"]*application_button[^"]*"[^>]*href="([^"]+)"/i);
  const posting = readJobPosting(page.body);
  return {
    ...job,
    applyUrl: button ? decodeEntities(button[1]!) : (posting?.applyUrl ?? null),
    salary: job.salary ?? posting?.salary ?? null,
    page: { url: page.url, html: compactPageCopy(page.body) },
  };
}

function termIds(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((v): v is number => typeof v === "number") : [];
}

// WordPress `*_gmt` fields are UTC without a zone designator.
function gmt(value: string | null): string | null {
  return value ? `${value}Z` : null;
}
