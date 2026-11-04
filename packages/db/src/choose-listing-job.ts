/** The job a listing was saved into before, and whether other listings are part of it too. */
export interface ListedJob {
  id: string;
  shared: boolean;
}

export interface ListingJobChoice {
  /** The job to save the listing's text into; null means a new job. */
  saveInto: string | null;
  /** The listing's previous job, when the listing leaves it and nothing else lists it. */
  deleteJob: string | null;
}

/**
 * Picks the job a listing belongs to:
 * 1. the job with the same apply link and title, merging the listing into it;
 * 2. otherwise the listing's own job, edited in place, unless other listings share it;
 * 3. otherwise a new job.
 */
export function chooseListingJob(matchingJobId: string | null, listedJob: ListedJob | null): ListingJobChoice {
  const saveInto = matchingJobId ?? (listedJob && !listedJob.shared ? listedJob.id : null);
  const leftBehind = listedJob && !listedJob.shared && listedJob.id !== saveInto;
  return { saveInto, deleteJob: leftBehind ? listedJob.id : null };
}
