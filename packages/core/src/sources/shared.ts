import { compactPageCopy, readJobPosting } from "../html";
import { HttpError, type HttpResponse } from "../http";
import type { NormalizedJob, SourceContext } from "../jobs";

/** True once the run's time budget for fetching extra pages is used up. */
export function pastDeadline(context: SourceContext): boolean {
  return Date.now() >= context.deadline.getTime();
}

/**
 * GETs an optional extra page, such as one job's page. A missing or broken
 * page returns null so one bad job cannot fail the whole source; network
 * errors and timeouts still throw.
 */
export async function getOptional(
  context: SourceContext,
  url: string,
): Promise<HttpResponse | null> {
  try {
    return await context.http.get(url);
  } catch (error) {
    if (error instanceof HttpError) {
      return null;
    }
    throw error;
  }
}

/** How many days of newsletter issues each check reads. */
export const NEWSLETTER_WINDOW_DAYS = 21;

/**
 * For sources that only link to the employer's application page: fetches
 * that page once and fills in what its schema.org `JobPosting` adds (most
 * ATS pages have one). The source's own values win. Any failure leaves the
 * job as it was, because an employer's site being down must not fail the
 * source.
 */
export async function withApplyPage(
  context: SourceContext,
  job: NormalizedJob,
): Promise<NormalizedJob> {
  if (!job.applyUrl) {
    return job;
  }
  let page: HttpResponse | null;
  try {
    page = await getOptional(context, job.applyUrl);
  } catch {
    return job;
  }
  const posting = page ? readJobPosting(page.body) : null;
  if (!page || !posting) {
    return job;
  }
  return {
    ...job,
    orgName: job.orgName ?? posting.orgName,
    orgWebsite: job.orgWebsite ?? posting.orgWebsite,
    description: job.description ?? posting.description,
    location: job.location ?? posting.location,
    remoteType: job.remoteType ?? posting.remoteType,
    salary: job.salary ?? posting.salary,
    postedAt: job.postedAt ?? posting.postedAt,
    expiresAt: job.expiresAt === undefined ? posting.expiresAt ?? undefined : job.expiresAt,
    page: { url: page.url, html: compactPageCopy(page.body) },
  };
}
