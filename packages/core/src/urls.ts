/**
 * URL helpers for matching the same job across sources: a normalized form of
 * any link, ATS (applicant tracking system) identifiers that survive
 * different link styles, and the employer's own domain.
 */

// Query parameters that only track where a click came from.
const TRACKING_PARAMS = [
  /^utm_/i, /^ref$/i, /^ref_?src$/i, /^source$/i, /^src$/i, /^gh_src$/i,
  /^lever-source/i, /^lever-origin$/i, /^fbclid$/i, /^gclid$/i, /^mc_[ce]id$/i,
  /^_bhiiv$/i, /^bhcl_id$/i, /^cn-reloaded$/i, /^sq$/i, /^usp$/i,
];

/**
 * Lowercases the host, drops `www.`, the fragment, tracking parameters and a
 * trailing slash, and sorts the remaining parameters. Returns null for
 * anything that is not an http(s) URL.
 */
export function normalizeUrl(raw: string | null | undefined): string | null {
  const url = parseHttpUrl(raw);
  if (!url) {
    return null;
  }
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.some((pattern) => pattern.test(key)))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = new URLSearchParams(params).toString();
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "");
  return `${host}${path}${query ? `?${query}` : ""}`;
}

/** An ATS a job link points at, with the employer's account slug on it when the link shows one. */
export interface AtsLink {
  provider: string;
  /** The employer's account name in the ATS, such as `raft` in `job-boards.greenhouse.io/raft/...`. */
  orgSlug: string | null;
  jobId: string;
}

/** Recognizes links to the common ATSs, whatever the link style. */
export function parseAtsLink(raw: string | null | undefined): AtsLink | null {
  const url = parseHttpUrl(raw);
  if (!url) {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  const seg = (i: number) => segments[i] ?? null;

  // Greenhouse job ids are global, so `gh_jid` on an employer's own careers page works too.
  const ghJid = url.searchParams.get("gh_jid");
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    // boards.greenhouse.io/<org>/jobs/<id>, job-boards.greenhouse.io/<org>/jobs/<id>,
    // boards-api.greenhouse.io/v1/boards/<org>/jobs/<id>, boards.greenhouse.io/embed/job_app?for=<org>&token=<id>
    const isEmbed = seg(0) === "embed";
    const jobsAt = segments.indexOf("jobs");
    const jobId =
      ghJid ??
      (isEmbed ? url.searchParams.get("token") : jobsAt > 0 ? seg(jobsAt + 1) : null);
    const orgSlug = isEmbed
      ? url.searchParams.get("for")
      : jobsAt > 0
        ? seg(jobsAt - 1)
        : null;
    if (jobId && /^\d+$/.test(jobId)) {
      return { provider: "greenhouse", orgSlug, jobId };
    }
  }
  if (ghJid && /^\d+$/.test(ghJid)) {
    return { provider: "greenhouse", orgSlug: null, jobId: ghJid };
  }
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    if (seg(0) && seg(1)) {
      return { provider: "lever", orgSlug: seg(0), jobId: seg(1)! };
    }
  }
  if (host === "jobs.ashbyhq.com") {
    if (seg(0) && seg(1)) {
      return { provider: "ashby", orgSlug: seg(0), jobId: seg(1)! };
    }
  }
  const workday = host.match(/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/);
  if (workday) {
    const last = segments[segments.length - 1] ?? "";
    const requisition = last.match(/_([A-Za-z0-9-]+)$/)?.[1];
    if (requisition) {
      return { provider: "workday", orgSlug: workday[1]!, jobId: requisition.toUpperCase() };
    }
  }
  const bamboo = host.match(/^([a-z0-9-]+)\.bamboohr\.com$/);
  if (bamboo && seg(0) === "careers" && seg(1)) {
    return { provider: "bamboohr", orgSlug: bamboo[1]!, jobId: seg(1)! };
  }
  const applyToJob = host.match(/^([a-z0-9-]+)\.applytojob\.com$/);
  if (applyToJob && seg(0) === "apply" && seg(1)) {
    return { provider: "jazzhr", orgSlug: applyToJob[1]!, jobId: seg(1)! };
  }
  if (host === "apply.workable.com" && seg(1) === "j" && seg(2)) {
    return { provider: "workable", orgSlug: seg(0), jobId: seg(2)! };
  }
  if (host === "jobs.smartrecruiters.com" && seg(0) && seg(1)) {
    const jobId = seg(1)!.match(/^(\d+)/)?.[1];
    if (jobId) {
      return { provider: "smartrecruiters", orgSlug: seg(0), jobId };
    }
  }
  if (host === "jobs.jobvite.com" && seg(1) === "job" && seg(2)) {
    return { provider: "jobvite", orgSlug: seg(0), jobId: seg(2)! };
  }
  const recruitee = host.match(/^([a-z0-9-]+)\.recruitee\.com$/);
  if (recruitee && seg(0) === "o" && seg(1)) {
    return { provider: "recruitee", orgSlug: recruitee[1]!, jobId: seg(1)! };
  }
  if (host === "app.dover.com" && seg(0) === "apply" && seg(2)) {
    return { provider: "dover", orgSlug: seg(1), jobId: seg(2)! };
  }
  // Job boards whose links come in several styles: a newsletter links
  // jobs.diversifytech.com/job/123 for the board's jobs.diversifytech.com/job/123-title-employer.
  const diversifyTech = host === "jobs.diversifytech.com" && seg(0) === "job" && seg(1)?.match(/^(\d+)/);
  if (diversifyTech) {
    return { provider: "diversifytech", orgSlug: null, jobId: diversifyTech[1]! };
  }
  const techJobsForGood = /^(www\.)?techjobsforgood\.com$/.test(host) && seg(0) === "jobs" && seg(1)?.match(/^(\d+)$/);
  if (techJobsForGood) {
    return { provider: "techjobsforgood", orgSlug: null, jobId: techJobsForGood[1]! };
  }
  return null;
}

// JazzHR reuses one posting code for different jobs (seen on DSCovery in October 2026).
const NON_UNIQUE_JOB_IDS = new Set(["jazzhr"]);

/**
 * Keys that identify the job a link points at. Two links that share any key
 * are the same job. Includes the normalized URL and, for ATS links, an
 * identifier that is the same across the ATS's different link styles.
 */
export function linkKeys(raw: string | null | undefined): string[] {
  const normalized = normalizeUrl(raw);
  if (!normalized) {
    return [];
  }
  const keys = [`url:${normalized}`];
  const ats = parseAtsLink(raw);
  if (ats && !NON_UNIQUE_JOB_IDS.has(ats.provider)) {
    // Greenhouse and job-board ids are unique on their own; the others are per account.
    keys.push(
      ats.orgSlug === null || ats.provider === "greenhouse"
        ? `ats:${ats.provider}:${ats.jobId}`
        : `ats:${ats.provider}:${ats.orgSlug.toLowerCase()}:${ats.jobId}`,
    );
  }
  return keys;
}

// Hosts that belong to an ATS, a job board, or a document host rather than to an employer.
const NON_EMPLOYER_HOSTS = [
  "greenhouse.io", "lever.co", "ashbyhq.com", "myworkdayjobs.com", "workday.com",
  "bamboohr.com", "applytojob.com", "workable.com", "smartrecruiters.com",
  "jobvite.com", "recruitee.com", "dover.com", "icims.com", "paycomonline.net",
  "paylocity.com", "adp.com", "ultipro.com", "ukg.com", "taleo.net", "oraclecloud.com",
  "csod.com", "peopleclick.com", "breezy.hr", "rippling.com", "teamtailor.com",
  "pinpointhq.com", "jazzhr.com", "hire.trakstar.com", "governmentjobs.com",
  "usajobs.gov", "linkedin.com", "indeed.com", "idealist.org", "google.com",
  "forms.gle", "notion.site", "notion.so", "airtable.com", "typeform.com",
  "civicworkstudio.com", "techjobsforgood.com", "diversifytech.com",
  "diversifytech.co", "civictech.guide", "fly.dev", "niceboard.co",
  "campaign-archive.com", "beehiiv.com", "grnh.se", "bit.ly",
];

// Second-level suffixes under which the registrable domain has three labels.
const MULTI_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "org.au", "gov.au", "co.nz",
  "org.nz", "co.za", "org.za", "com.br", "co.in", "org.in", "co.jp", "or.jp",
  "co.ke", "or.ke", "com.mx", "com.ng", "org.ng", "com.sg", "org.sg", "ca.gov",
]);

/** The registrable domain of a host, such as `bixal.com` for `careers.bixal.com`. */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (labels.length <= 2) {
    return labels.join(".");
  }
  const lastTwo = labels.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(lastTwo) || /^[a-z]{2}\.us$/.test(lastTwo)) {
    return labels.slice(-3).join(".");
  }
  return lastTwo;
}

/**
 * The employer's domain from a link to its website or its own careers page.
 * Null for links to an ATS, a job board, or a document host.
 */
export function employerDomain(raw: string | null | undefined): string | null {
  const url = parseHttpUrl(raw);
  if (!url) {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const isNonEmployer = NON_EMPLOYER_HOSTS.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
  return isNonEmployer ? null : registrableDomain(host);
}

/** Parses an absolute http(s) URL, or returns null. */
export function parseHttpUrl(raw: string | null | undefined): URL | null {
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
