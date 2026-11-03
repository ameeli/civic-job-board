import { expect, it, vi } from "vitest";

// The sign-in check runs on every request, so it must not load the Tech Jobs
// for Gov module (or the page parsers it brings in) or the job tag lists.
vi.mock("@civic-job-board/core/tech-jobs-for-gov", () => {
  throw new Error("the sign-in check loaded the Tech Jobs for Gov module");
});
vi.mock("@civic-job-board/core/job-tags", () => {
  throw new Error("the sign-in check loaded the job tags module");
});

it("loads the sign-in check without the job-fetching or job tags modules", async () => {
  await expect(import("./proxy")).resolves.toHaveProperty("proxy");
});
