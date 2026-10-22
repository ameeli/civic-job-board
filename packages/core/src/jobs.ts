import type { HttpClient } from "./http";

export type RemoteType = "remote" | "hybrid" | "onsite";
export type SalaryPeriod = "year" | "month" | "week" | "day" | "hour";

export interface Salary {
  min: number | null;
  max: number | null;
  /** ISO 4217 code, such as `USD`. */
  currency: string | null;
  period: SalaryPeriod;
}

/** A category label the board itself put on the job, such as its job function or impact area. */
export interface BoardTag {
  /** What kind of label it is on that board, such as `category` or `impact_area`. */
  axis: string;
  tag: string;
}

/** A copy of a public job page, kept so a job can be re-read after the board drops it. */
export interface PageCopy {
  url: string;
  html: string;
}

/** One job as one source describes it, in the shape every adapter produces. */
export interface NormalizedJob {
  /** The source's own stable id for the job; unique within the source. */
  externalId: string;
  /** Where the job is shown on the source. */
  sourceUrl: string;
  title: string;
  orgName: string | null;
  /** The employer's own website, when the source names it. */
  orgWebsite: string | null;
  location: string | null;
  remoteType: RemoteType | null;
  salary: Salary | null;
  /** Plain text, with paragraphs separated by blank lines. */
  description: string | null;
  applyUrl: string | null;
  postedAt: Date | null;
  /** When applications close; null clears a deadline, omitted leaves it unknown. */
  expiresAt?: Date | null;
  boardTags: BoardTag[];
  /**
   * A marker that changes whenever the source edits the job (for example a
   * last-modified time), so unchanged jobs are not fetched again.
   */
  version?: string | null;
  /** How the source found the job, such as `around the web` for a newsletter's third-party picks. */
  via?: string | null;
  page?: PageCopy | null;
}

/** What the daily check already knows about one of a source's jobs. */
export interface KnownJob {
  version: string | null;
}

export interface SourceContext {
  http: HttpClient;
  now: Date;
  /** The source's jobs already stored, by external id. */
  known: ReadonlyMap<string, KnownJob>;
  /** Adapters stop fetching extra pages after this time and report a partial result. */
  deadline: Date;
}

export interface SourceResult {
  /** Jobs on the required listing, when closure IDs include other listings. */
  seen?: number;
  jobs: NormalizedJob[];
  /**
   * Every external id the source currently lists, when the source exposes its
   * full listing. A stored job missing from it for several checks is closed.
   * Null when the source only shows recent jobs (a feed or newsletter).
   */
  listedIds: string[] | null;
  /** True when the deadline cut the work short; the rest is picked up by the next run. */
  partial: boolean;
}

export interface SourceAdapter {
  /** Stable key stored in the database, such as `tech-jobs-for-gov`. */
  id: string;
  name: string;
  /** Credit the source's license asks for wherever its jobs are shown. */
  attribution?: { text: string; url: string };
  /**
   * True for newsletters, whose `sourceUrl` is an issue that lists many
   * jobs, so it cannot identify a job.
   */
  sharedSourceUrls?: boolean;
  fetchJobs(context: SourceContext): Promise<SourceResult>;
}
