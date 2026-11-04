import { expect, it } from "vitest";
import { chooseListingJob } from "./choose-listing-job";

it("creates a job for a first-seen listing with no matching job", () => {
  expect(chooseListingJob(null, null)).toEqual({ saveInto: null, deleteJob: null });
});

it("merges a first-seen listing into the job with the same apply link and title", () => {
  expect(chooseListingJob("match", null)).toEqual({ saveInto: "match", deleteJob: null });
});

it("saves a listing seen again into its own job", () => {
  expect(chooseListingJob("own", { id: "own", shared: false })).toEqual({ saveInto: "own", deleteJob: null });
  expect(chooseListingJob("own", { id: "own", shared: true })).toEqual({ saveInto: "own", deleteJob: null });
});

it("edits the listing's own job in place when its new apply link and title match no job", () => {
  expect(chooseListingJob(null, { id: "own", shared: false })).toEqual({ saveInto: "own", deleteJob: null });
});

it("splits an edited listing off a job other listings still share", () => {
  expect(chooseListingJob(null, { id: "shared", shared: true })).toEqual({ saveInto: null, deleteJob: null });
  expect(chooseListingJob("match", { id: "shared", shared: true })).toEqual({ saveInto: "match", deleteJob: null });
});

it("merges an edited listing into a matching job and deletes the job it leaves empty", () => {
  expect(chooseListingJob("match", { id: "own", shared: false })).toEqual({ saveInto: "match", deleteJob: "own" });
});
