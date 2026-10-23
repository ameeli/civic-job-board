import { parseSitemap } from "../feeds";
import { asString, compactPageCopy, isRecord, parseDate, readJobPosting } from "../html";
import type { BoardTag, NormalizedJob, Salary, SalaryPeriod, SourceAdapter, SourceContext } from "../jobs";
import { parseRemoteType } from "../location";
import { parseAmount, sanitizeSalary } from "../salary";
import { cleanText, htmlToText } from "../text";
import { getOptional, pastDeadline } from "./shared";

const SITEMAP_URL = "https://jobs.diversifytech.com/sitemap-jobs.xml";

/** robots.txt asks for `Crawl-delay: 1` on this host. */
export const DIVERSIFY_TECH_HOST_DELAY = { "jobs.diversifytech.com": 1_000 };

/**
 * Diversify Tech's job board (a Niceboard site). Its job sitemap lists every
 * open job; each new job's page is fetched once and read from its schema.org
 * `JobPosting` plus the job record the page embeds for its own scripts, which
 * adds the apply link, remote flags, pay range, and the board's categories.
 */
export const diversifyTech: SourceAdapter = {
  id: "diversify-tech",
  name: "Diversify Tech",
  async fetchJobs(context) {
    const sitemap = await context.http.get(SITEMAP_URL);
    const listed = parseSitemap(sitemap.body).flatMap(({ url }) => {
      const id = url.match(/\/job\/(\d+)/)?.[1];
      return id ? [{ id, url }] : [];
    });
    const jobs: NormalizedJob[] = [];
    let partial = false;
    for (const { id, url } of listed) {
      if (context.known.has(id)) {
        continue;
      }
      if (pastDeadline(context)) {
        partial = true;
        break;
      }
      const job = await fetchJobPage(context, id, url);
      if (job) {
        jobs.push(job);
      }
    }
    return { jobs, listedIds: listed.map(({ id }) => id), partial };
  },
};

async function fetchJobPage(
  context: SourceContext,
  externalId: string,
  url: string,
): Promise<NormalizedJob | null> {
  const page = await getOptional(context, url);
  if (!page) {
    return null;
  }
  const posting = readJobPosting(page.body);
  const record = readEmbeddedJob(page.body);
  const title = posting?.title ?? cleanText(asString(record?.title));
  if (!title) {
    return null;
  }
  const company = isRecord(record?.company) ? record.company : null;
  const location = cleanText(asString(record?.location_name)) ?? posting?.location ?? null;
  const remote = record?.remote_only === true || record?.is_remote === true;
  const descriptionHtml = asString(record?.description_html);
  const filledAt = record?.is_filled === true ? parseDate(asString(record.filled_at)) : null;

  return {
    externalId,
    sourceUrl: page.url,
    title,
    orgName: posting?.orgName ?? cleanText(asString(company?.name)),
    orgWebsite: posting?.orgWebsite ?? asString(company?.site_url),
    location,
    remoteType: remote ? "remote" : (parseRemoteType(location) ?? posting?.remoteType ?? null),
    salary: embeddedSalary(record) ?? posting?.salary ?? null,
    description: descriptionHtml ? htmlToText(descriptionHtml) : (posting?.description ?? null),
    // Jobs that take applications on the board itself have no external link.
    applyUrl: asString(record?.apply_url) ?? page.url,
    postedAt: posting?.postedAt ?? parseDate(asString(record?.published_at)),
    expiresAt: filledAt ?? posting?.expiresAt ?? parseDate(asString(record?.expires_on)) ?? undefined,
    boardTags: boardTags(record),
    page: { url: page.url, html: compactPageCopy(page.body) },
  };
}

// The page's scripts get the job as `var job_json = {...};` on one line.
function readEmbeddedJob(html: string): Record<string, unknown> | null {
  const json = html.match(/var job_json = (\{.*\});\s*$/m)?.[1];
  if (!json) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(json);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const TIMEFRAMES: Record<string, SalaryPeriod> = {
  annually: "year", monthly: "month", weekly: "week", daily: "day", hourly: "hour",
};

function embeddedSalary(record: Record<string, unknown> | null): Salary | null {
  if (!record || record.show_salary === false) {
    return null;
  }
  const period = TIMEFRAMES[asString(record.salary_timeframe) ?? "annually"];
  if (!period) {
    return null;
  }
  return sanitizeSalary({
    min: parseAmount(asString(record.salary_min)),
    max: parseAmount(asString(record.salary_max)),
    currency: asString(record.salary_currency)?.toUpperCase() ?? null,
    period,
  });
}

function boardTags(record: Record<string, unknown> | null): BoardTag[] {
  if (!record) {
    return [];
  }
  const named = (value: unknown) => (isRecord(value) ? cleanText(asString(value.name)) : null);
  const tags: (BoardTag | null)[] = [
    tagOf("category", named(record.category)),
    tagOf("level", named(record.secondary_category)),
    tagOf("job_type", named(record.jobtype)),
    ...(Array.isArray(record.tags) ? record.tags.map((tag) => tagOf("tag", named(tag))) : []),
  ];
  return tags.filter((tag): tag is BoardTag => tag !== null);
}

function tagOf(axis: string, tag: string | null): BoardTag | null {
  return tag ? { axis, tag } : null;
}
