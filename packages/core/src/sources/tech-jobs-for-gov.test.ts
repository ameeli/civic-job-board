import { describe, expect, it } from "vitest";
import { fakeHttp, testContext } from "./fake-http";
import { techJobsForGov } from "./tech-jobs-for-gov";

const API = "https://civicworkstudio.com/wp-json/wp/v2";
const LISTING = `${API}/job-listings?per_page=100&page=1&_fields=id,modified_gmt&orderby=id&order=asc`;

function routes(extra = {}) {
  return {
    [LISTING]: { fixture: "tech-jobs-for-gov/listing.json", headers: { "X-WP-TotalPages": "1" } },
    [`${API}/job-categories?per_page=100&_fields=id,name`]: { fixture: "tech-jobs-for-gov/job-categories.json" },
    [`${API}/job-types?per_page=100&_fields=id,name`]: { fixture: "tech-jobs-for-gov/job-types.json" },
    "https://civicworkstudio.com/job/chief-innovation-and-information-officer/": { fixture: "tech-jobs-for-gov/job-3756.html" },
    "https://civicworkstudio.com/job/chief-digital-officer/": { fixture: "tech-jobs-for-gov/job-3749.html" },
    "https://civicworkstudio.com/job/ai-product-manager-2/": { fixture: "tech-jobs-for-gov/job-3748.html" },
    ...extra,
  };
}

describe("Tech Jobs for Gov", () => {
  it("normalizes new jobs from the REST record and the job page", async () => {
    const http = fakeHttp(
      routes({
        [`${API}/job-listings?include=3756,3749,3748&per_page=100`]: { fixture: "tech-jobs-for-gov/records.json" },
      }),
    );

    const result = await techJobsForGov.fetchJobs(testContext(http));

    expect(result.partial).toBe(false);
    expect(result.listedIds).toEqual(["3756", "3749", "3748"]);
    expect(result.jobs).toHaveLength(3);
    const job = result.jobs.find((j) => j.externalId === "3749")!;
    expect(job).toMatchObject({
      sourceUrl: "https://civicworkstudio.com/job/chief-digital-officer/",
      title: "Chief Digital Officer",
      orgName: "City of Indianapolis and Marion County",
      orgWebsite: null,
      location: "Indianapolis, IN",
      remoteType: "hybrid",
      salary: { min: 106645, max: null, currency: "USD", period: "year" },
      applyUrl: "https://www.governmentjobs.com/jobs/5474426-0/chief-digital-officer",
      postedAt: new Date("2026-09-09T22:07:16Z"),
      expiresAt: new Date("2026-12-07T00:00:00Z"),
      version: "2026-09-09T23:30:41",
      boardTags: [
        { axis: "category", tag: "Executive Leadership" },
        { axis: "job_type", tag: "Full-time" },
        { axis: "organization_type", tag: "City" },
      ],
    });
    expect(job.description).toMatch(/\S/);
    expect(job.page?.html).toContain("application/ld+json");
    expect(job.page?.html).not.toMatch(/<script(?![^>]*ld\+json)/i);
  });

  it.each([null, undefined])("distinguishes cleared and omitted REST deadlines: %s", async (deadline) => {
    const records = (await import("./fixtures/tech-jobs-for-gov/records.json")).default;
    const result = await techJobsForGov.fetchJobs(testContext(fakeHttp(routes({
      [`${API}/job-listings?include=3756,3749,3748&per_page=100`]: {
        body: JSON.stringify(records.map((record) => ({ ...record, _job_expires: deadline }))),
      },
    }))));

    expect(result.jobs).toHaveLength(3);
    expect(result.jobs.map((job) => job.expiresAt)).toEqual([deadline, deadline, deadline]);
  });

  it("re-reads only jobs that are new or changed", async () => {
    const http = fakeHttp(
      routes({
        [`${API}/job-listings?include=3748&per_page=100`]: {
          body: JSON.stringify(
            (await import("./fixtures/tech-jobs-for-gov/records.json")).default.filter(
              (r: { id: number }) => r.id === 3748,
            ),
          ),
        },
      }),
    );

    const result = await techJobsForGov.fetchJobs(
      testContext(http, {
        "3756": { version: "2026-09-09T23:30:54" },
        "3749": { version: "2026-09-09T23:30:41" },
        "3748": { version: "an older edit" },
      }),
    );

    expect(result.jobs.map((j) => j.externalId)).toEqual(["3748"]);
    expect(result.listedIds).toHaveLength(3);
  });

  it("only lists ids when nothing changed", async () => {
    const http = fakeHttp(routes());

    const result = await techJobsForGov.fetchJobs(
      testContext(http, {
        "3756": { version: "2026-09-09T23:30:54" },
        "3749": { version: "2026-09-09T23:30:41" },
        "3748": { version: "2026-09-09T23:30:39" },
      }),
    );

    expect(result).toEqual({ jobs: [], listedIds: ["3756", "3749", "3748"], partial: false });
    expect(http.requested).toEqual([LISTING]);
  });

  it("stops fetching job pages at the deadline and reports a partial result", async () => {
    const http = fakeHttp(
      routes({
        [`${API}/job-listings?include=3756,3749,3748&per_page=100`]: { fixture: "tech-jobs-for-gov/records.json" },
      }),
    );

    const result = await techJobsForGov.fetchJobs(
      testContext(http, {}, { deadline: new Date(0) }),
    );

    expect(result.partial).toBe(true);
    expect(result.jobs).toEqual([]);
    expect(result.listedIds).toHaveLength(3);
  });
});
