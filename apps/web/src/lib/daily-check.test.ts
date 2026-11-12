import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { jobListings, jobs, readJobs, readJobsToTag, saveJobTags, sourceRuns, type Db } from "@civic-job-board/db";
import { createTestDb } from "@civic-job-board/db/testing";
import record from "../../../../packages/core/src/fixtures/gov-listing.json";
import ctfgFeed from "../../../../packages/core/src/fixtures/civic-tech-field-guide-feed.json";
import { fetchAndSaveSource, JOB_SOURCES, tagUntaggedJobs } from "./daily-check";
import { NO_LISTINGS_ERROR } from "./save-source-listings";

// Live Diversify Tech and Tech Jobs for Good captures, 2026-11-04, and a Diversify Tech newsletter
// capture, 2026-11-11, the same ones the parsers' tests read.
const fixture = (name: string) => readFileSync(new URL(`../../../../packages/core/src/fixtures/${name}`, import.meta.url), "utf8");
const diversifySitemap = fixture("diversify-tech-sitemap-jobs.xml");
const diversifyJobPage = fixture("diversify-tech-job-page.html");
const tjfgJobList = fixture("tech-jobs-for-good-jobs.html");
const tjfgJobPage = fixture("tech-jobs-for-good-job-page.html");
const newsletterFeed = fixture("diversify-tech-newsletter-feed.xml");

let db: Db;

// Real Gemini is never called: tests without a fake Gemini run with no key.
beforeEach(async () => {
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.spyOn(console, "log").mockImplementation(() => {});
  // Keep cold Postgres startup and migrations outside the behavior test timeout.
  db = await createTestDb();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const runsOf = async (db: Db, source: string) => (await db.select().from(sourceRuns).orderBy(sourceRuns.id)).filter(run => run.source === source);
const govRuns = (db: Db) => runsOf(db, "tech-jobs-for-gov");
const ctfgRuns = (db: Db) => runsOf(db, "civic-tech-field-guide");
const taggingRuns = (db: Db) => runsOf(db, "gemini-tagging");
const logLines = () => vi.mocked(console.log).mock.calls.map(([line]) => String(line));
/** A Tech Jobs for Gov listing with its own apply link, so it is a job of its own. */
const govListing = (id: number, fields: object = {}) => ({
  ...record, id, meta: { _application: `https://example.org/apply/${id}` }, ...fields,
});

type FakeRequest = (url: string, init?: RequestInit) => Promise<Response>;
const emptyCtfgFeed: FakeRequest = async () => Response.json({ items: [] });
const emptyDiversifySitemap: FakeRequest = async () => new Response("<urlset></urlset>");
const emptyTjfgJobList: FakeRequest = async () => new Response("<html></html>");
const emptyNewsletterFeed: FakeRequest = async () => new Response("<rss><channel></channel></rss>");
const noGemini: FakeRequest = async () => { throw new Error("Unexpected Gemini request"); };

/** Fakes every request the daily check makes: each source, then Gemini. */
function fakeRequests({
  gov, ctfg = emptyCtfgFeed, diversify = emptyDiversifySitemap, tjfg = emptyTjfgJobList,
  newsletter = emptyNewsletterFeed, gemini = noGemini,
}: {
  gov: FakeRequest; ctfg?: FakeRequest; diversify?: FakeRequest; tjfg?: FakeRequest;
  newsletter?: FakeRequest; gemini?: FakeRequest;
}) {
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (url.startsWith("https://civicworkstudio.com/")) return gov(url, init);
    if (url.startsWith("https://civictech.guide/")) return ctfg(url, init);
    if (url.startsWith("https://jobs.diversifytech.com/")) return diversify(url, init);
    if (url.startsWith("https://techjobsforgood.com/")) return tjfg(url, init);
    if (url.startsWith("https://rss.beehiiv.com/")) return newsletter(url, init);
    return gemini(url, init);
  }));
}

/** Each source's fetch cron, one after another in schedule order. */
async function fetchEverySource(db: Db, options?: Parameters<typeof fetchAndSaveSource>[2]) {
  const sourceRuns = [];
  for (const source of JOB_SOURCES) sourceRuns.push(await fetchAndSaveSource(db, source, options));
  return sourceRuns;
}

/** The fetch crons, then a tagging cron, as they run each night. */
async function fetchThenTag(db: Db, options?: Parameters<typeof tagUntaggedJobs>[1]) {
  await fetchEverySource(db);
  return tagUntaggedJobs(db, options);
}

it("saves API application links, then updates missing links to null", async () => {
  const gov = vi.fn().mockResolvedValueOnce(Response.json([{ ...record, meta: {
    _application: "https://example.org/?a=1&amp;b=2",
  } }]));
  fakeRequests({ gov });
  expect(await fetchEverySource(db)).toMatchObject([
    { source: "tech-jobs-for-gov", ok: true, seen: 1, new: 1, error: null },
    { source: "civic-tech-field-guide", ok: false, seen: 0, new: 0, error: NO_LISTINGS_ERROR },
    { source: "diversify-tech", ok: false, seen: 0, new: 0, error: NO_LISTINGS_ERROR },
    { source: "tech-jobs-for-good", ok: false, seen: 0, new: 0, error: NO_LISTINGS_ERROR },
    { source: "diversify-tech-newsletter", ok: false, seen: 0, new: 0, error: NO_LISTINGS_ERROR },
  ]);
  expect(await db.select().from(jobs)).toMatchObject([{ applyUrl: "https://example.org/?a=1&b=2" }]);
  gov.mockResolvedValueOnce(Response.json([{ ...record, meta: {}, _job_salary: "Competitive" }]));
  expect(await fetchEverySource(db)).toMatchObject([{ ok: true, seen: 1, new: 0 }, { ok: false }, { ok: false }, { ok: false }, { ok: false }]);
  expect(gov).toHaveBeenCalledTimes(2);
  expect(await db.select().from(jobs)).toMatchObject([{ salary: "Competitive", applyUrl: null }]);
  expect(await govRuns(db)).toHaveLength(2);
  expect(await taggingRuns(db)).toHaveLength(0);
});

it("records a source with no listings as failed without affecting the other sources", async () => {
  fakeRequests({
    gov: vi.fn().mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(new Response("", { status: 503 })),
    ctfg: async () => Response.json(ctfgFeed),
  });
  expect(await fetchEverySource(db)).toMatchObject([
    { source: "tech-jobs-for-gov", ok: false, seen: 0, new: 0, error: NO_LISTINGS_ERROR },
    { source: "civic-tech-field-guide", ok: true, seen: 2, new: 2, error: null },
    { ok: false }, { ok: false }, { ok: false },
  ]);
  expect(await fetchEverySource(db)).toMatchObject([
    { ok: false, seen: 0, new: 0, error: "Tech Jobs for Gov API: HTTP 503" }, { ok: true }, { ok: false }, { ok: false }, { ok: false },
  ]);
  expect(await govRuns(db)).toHaveLength(2);
});

it("retains successful saves and counts them when a later listing is invalid", async () => {
  fakeRequests({ gov: async () => Response.json([record, { ...record, id: null }]) });
  expect(await fetchEverySource(db)).toMatchObject([
    { ok: false, seen: 2, new: 1, error: "Invalid Tech Jobs for Gov listing" }, { ok: false }, { ok: false }, { ok: false }, { ok: false },
  ]);
  expect(await db.select().from(jobs)).toHaveLength(1);
  expect(await govRuns(db)).toHaveLength(1);
});

it("saves Civic Tech Field Guide jobs and tags them with their employer", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  const gemini = vi.fn<FakeRequest>(async () => taggedAnswer());
  fakeRequests({ gov: async () => Response.json([record]), ctfg: async () => Response.json(ctfgFeed), gemini });

  expect(await fetchEverySource(db)).toMatchObject([
    { source: "tech-jobs-for-gov", ok: true, seen: 1, new: 1 },
    { source: "civic-tech-field-guide", ok: true, seen: 2, new: 2, error: null },
    { source: "diversify-tech", ok: false, seen: 0, error: NO_LISTINGS_ERROR },
    { source: "tech-jobs-for-good", ok: false, seen: 0, error: NO_LISTINGS_ERROR },
    { source: "diversify-tech-newsletter", ok: false, seen: 0, error: NO_LISTINGS_ERROR },
  ]);
  // Both Field Guide jobs were added the same day, so the list's order between them is arbitrary.
  const listed = await readJobs(db);
  expect(listed).toHaveLength(3);
  expect(listed).toEqual(expect.arrayContaining([
    expect.objectContaining({ title: "Senior DevOps Engineer", sources: ["tech-jobs-for-gov"] }),
    expect.objectContaining({
      title: "Associate Director, Strategy", employerName: "Wellcome Trust", sources: ["civic-tech-field-guide"],
      applyUrl: expect.stringContaining("myworkdayjobs.com"), sourceUrl: "https://app.civictech.guide/job?recordId=recbyxPQel9RAHEV3",
    }),
    expect.objectContaining({ title: "Vice President, Head of Trust & Safety", employerName: "Lego Digital Play", sources: ["civic-tech-field-guide"] }),
  ]));

  await tagUntaggedJobs(db, { sleep: async () => {} });
  expect(gemini).toHaveBeenCalledTimes(3);
  const prompts = gemini.mock.calls.map(([, init]) => String(init?.body));
  expect(prompts).toContainEqual(expect.stringContaining("Wellcome Trust"));
  expect(await taggingRuns(db)).toMatchObject([{ ok: true, seen: 3, new: 3 }]);

  expect(await fetchEverySource(db)).toMatchObject([{ new: 0 }, { ok: true, seen: 2, new: 0 }, { ok: false }, { ok: false }, { ok: false }]);
  expect(await db.select().from(jobs)).toHaveLength(3);
});

it("merges a job both sources list with the same apply link and title, and tags it once", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  const gemini = vi.fn<FakeRequest>(async () => taggedAnswer());
  const [guideItem] = ctfgFeed.items;
  const govCopy = govListing(4296, { title: { rendered: guideItem!.data.role }, meta: { _application: guideItem!.link } });
  fakeRequests({ gov: async () => Response.json([govCopy, govListing(4297)]), ctfg: async () => Response.json(ctfgFeed), gemini });

  expect(await fetchEverySource(db)).toMatchObject([
    { source: "tech-jobs-for-gov", ok: true, seen: 2, new: 2 },
    { source: "civic-tech-field-guide", ok: true, seen: 2, new: 1 },
    { source: "diversify-tech", ok: false },
    { source: "tech-jobs-for-good", ok: false },
    { source: "diversify-tech-newsletter", ok: false },
  ]);
  await tagUntaggedJobs(db, { sleep: async () => {} });
  expect(gemini).toHaveBeenCalledTimes(3);
  expect(await readJobs(db)).toHaveLength(3);
  expect(await readJobs(db)).toContainEqual(expect.objectContaining({
    title: "Associate Director, Strategy", employerName: "Wellcome Trust",
    sources: ["civic-tech-field-guide", "tech-jobs-for-gov"], roleTags: ["security"],
  }));
});

it("saves Diversify Tech jobs, merges one Tech Jobs for Gov also lists, and tags each job once", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  const gemini = vi.fn<FakeRequest>(async () => taggedAnswer());
  // The sitemap lists two jobs: the saved page, and a second job served with a record of its own.
  const secondPage = diversifyJobPage.replace('"id":2551571,"title":"Web Developer"', '"id":2580758,"title":"Head of Technology"')
    .replace(/"apply_url":"[^"]*"/, '"apply_url":"https://example.org/apply/head-of-technology"');
  const diversify: FakeRequest = async url => new Response(
    url.endsWith("sitemap-jobs.xml") ? diversifySitemap : url.includes("/job/2580758") ? secondPage : diversifyJobPage,
  );
  const govCopy = govListing(4296, {
    title: { rendered: "Web Developer" },
    meta: { _application: "https://secure.entertimeonline.com/ta/mopbc0031.careers?applytojob=889327873&amp;full_apply=&amp;jobid=889327873" },
  });
  fakeRequests({ gov: async () => Response.json([govCopy]), diversify, gemini });
  const sleep = vi.fn(async () => {});

  expect(await fetchEverySource(db, { sleep })).toMatchObject([
    { source: "tech-jobs-for-gov", ok: true, seen: 1, new: 1 },
    { source: "civic-tech-field-guide", ok: false, seen: 0, error: NO_LISTINGS_ERROR },
    { source: "diversify-tech", ok: true, seen: 2, new: 1, error: null },
    { source: "tech-jobs-for-good", ok: false, seen: 0, error: NO_LISTINGS_ERROR },
    { source: "diversify-tech-newsletter", ok: false, seen: 0, error: NO_LISTINGS_ERROR },
  ]);
  expect(sleep.mock.calls).toEqual([[1_000], [1_000]]);
  await tagUntaggedJobs(db, { sleep: async () => {} });
  expect(gemini).toHaveBeenCalledTimes(2);
  const listed = await readJobs(db);
  expect(listed).toHaveLength(2);
  expect(listed).toEqual(expect.arrayContaining([
    expect.objectContaining({
      title: "Web Developer", employerName: "Colorado Public Radio",
      sources: ["diversify-tech", "tech-jobs-for-gov"], roleTags: ["security"],
    }),
    expect.objectContaining({
      title: "Head of Technology", sources: ["diversify-tech"],
      sourceUrl: "https://jobs.diversifytech.com/job/2580758-head-of-technology-sanctuary-computer",
    }),
  ]));
  // Diversify Tech was saved last, so the merged job shows its text.
  expect((await db.select().from(jobs)).find(job => job.title === "Web Developer")).toMatchObject({
    salary: "$76,286-101,641 (Annually)", location: expect.stringMatching(/^Denver, CO, USA \(Hybrid: /), deadline: "10/2/2026",
  });
});

it("saves the free Tech Jobs for Good jobs, merges one Tech Jobs for Gov also lists, and tags each job once", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  const gemini = vi.fn<FakeRequest>(async () => taggedAnswer());
  // The list's first page shows two jobs; its later pages are served empty.
  const secondJobPage = tjfgJobPage.replace('"title": "Senior Full Stack Web Engineer"', '"title": "Data Analyst"')
    .replace(/window\.open\('[^']*'/, "window.open('https://example.org/apply/data-analyst'");
  const tjfg: FakeRequest = async url => new Response(
    url === "https://techjobsforgood.com/jobs/" ? tjfgJobList : url.includes("?page=") ? "<html></html>"
      : url.endsWith("/37454/") ? secondJobPage : tjfgJobPage,
  );
  const govCopy = govListing(4296, {
    title: { rendered: "Senior Full Stack Web Engineer" },
    meta: { _application: "https://roisolutions.bamboohr.com/careers/97?source=aWQ9NTU%3D" },
  });
  fakeRequests({ gov: async () => Response.json([govCopy]), tjfg, gemini });
  const sleep = vi.fn(async () => {});

  expect(await fetchEverySource(db, { sleep })).toMatchObject([
    { source: "tech-jobs-for-gov", ok: true, seen: 1, new: 1 },
    { source: "civic-tech-field-guide", ok: false, seen: 0, error: NO_LISTINGS_ERROR },
    { source: "diversify-tech", ok: false, seen: 0, error: NO_LISTINGS_ERROR },
    { source: "tech-jobs-for-good", ok: true, seen: 2, new: 1, error: null },
    { source: "diversify-tech-newsletter", ok: false, seen: 0, error: NO_LISTINGS_ERROR },
  ]);
  expect(sleep).toHaveBeenCalledTimes(4);
  await tagUntaggedJobs(db, { sleep: async () => {} });
  expect(gemini).toHaveBeenCalledTimes(2);
  expect(await readJobs(db)).toEqual(expect.arrayContaining([
    expect.objectContaining({
      title: "Senior Full Stack Web Engineer", employerName: "ROI Solutions, Inc",
      sources: ["tech-jobs-for-good", "tech-jobs-for-gov"], roleTags: ["security"],
    }),
    expect.objectContaining({
      title: "Data Analyst", sources: ["tech-jobs-for-good"], sourceUrl: "https://techjobsforgood.com/jobs/37454/",
    }),
  ]));
  // Tech Jobs for Good was saved last, so the merged job shows its text.
  expect((await db.select().from(jobs)).find(job => job.title === "Senior Full Stack Web Engineer")).toMatchObject({
    salary: "$105,000 - $120,000 Per Year", location: "Medford, MA / Boston, MA / Remote (Select US States)", deadline: null,
  });
});

it("saves the newsletter's outside jobs, merges one Tech Jobs for Gov also lists, and tags each job once", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  // A day after issue #412, so the check reads #412 and #411.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T08:00:00Z"));
  const gemini = vi.fn<FakeRequest>(async () => taggedAnswer());
  const govCopy = govListing(4296, {
    title: { rendered: "Frontend Engineer II" },
    meta: { _application: "https://jobs.ashbyhq.com/openly/49e7e0e1-23b9-4d4f-9505-3d6646f384a7" },
  });
  fakeRequests({ gov: async () => Response.json([govCopy]), newsletter: async () => new Response(newsletterFeed), gemini });

  expect(await fetchEverySource(db)).toMatchObject([
    { source: "tech-jobs-for-gov", ok: true, seen: 1, new: 1 },
    { ok: false }, { ok: false }, { ok: false },
    { source: "diversify-tech-newsletter", ok: true, seen: 2, new: 1, error: null },
  ]);
  await tagUntaggedJobs(db, { sleep: async () => {} });
  expect(gemini).toHaveBeenCalledTimes(2);
  expect(await readJobs(db)).toEqual(expect.arrayContaining([
    expect.objectContaining({
      title: "Frontend Engineer II", employerName: "Openly",
      sources: ["diversify-tech-newsletter", "tech-jobs-for-gov"], roleTags: ["security"],
    }),
    expect.objectContaining({
      title: "Data Scientist: Product", employerName: "Thatch", sources: ["diversify-tech-newsletter"],
      applyUrl: "https://thatch.com/jobs/5461158008?gh_jid=5461158008",
      sourceUrl: "https://newsletter.diversifytech.com/p/diversify-tech-411",
    }),
  ]));
});

it("saves two sources checked at the same time without either overwriting the other", async () => {
  // Vercel can fire two sources' fetch crons within the same hour. Each feed answers only once
  // both checks have asked, so their saves overlap. PGlite runs one transaction at a time; on
  // Postgres, saveListing's advisory lock does the same across connections.
  let bothAsked!: () => void;
  const asked = new Promise<void>(resolve => { bothAsked = resolve; });
  let waiting = 2;
  const afterBothAsk = (answer: () => Response): FakeRequest => async () => {
    if (--waiting === 0) bothAsked();
    await asked;
    return answer();
  };
  const [guideItem] = ctfgFeed.items;
  const govCopy = govListing(4296, { title: { rendered: guideItem!.data.role }, meta: { _application: guideItem!.link } });
  fakeRequests({
    gov: afterBothAsk(() => Response.json([govCopy, govListing(4297)])),
    ctfg: afterBothAsk(() => Response.json(ctfgFeed)),
  });

  const [govRun, ctfgRun] = await Promise.all([
    fetchAndSaveSource(db, "tech-jobs-for-gov"), fetchAndSaveSource(db, "civic-tech-field-guide"),
  ]);
  expect([govRun, ctfgRun]).toMatchObject([
    { source: "tech-jobs-for-gov", ok: true, seen: 2, error: null },
    { source: "civic-tech-field-guide", ok: true, seen: 2, error: null },
  ]);
  // The shared job is new to whichever source saved it first, and counted once.
  expect(govRun!.new + ctfgRun!.new).toBe(3);
  expect(await db.select().from(jobListings)).toHaveLength(4);
  const listed = await readJobs(db);
  expect(listed).toHaveLength(3);
  expect(listed).toEqual(expect.arrayContaining([
    expect.objectContaining({ title: guideItem!.data.role, sources: ["civic-tech-field-guide", "tech-jobs-for-gov"] }),
    expect.objectContaining({ applyUrl: "https://example.org/apply/4297", sources: ["tech-jobs-for-gov"] }),
    expect.objectContaining({ title: "Vice President, Head of Trust & Safety", sources: ["civic-tech-field-guide"] }),
  ]));
  expect(await govRuns(db)).toMatchObject([{ id: govRun!.id }]);
  expect(await ctfgRuns(db)).toMatchObject([{ id: ctfgRun!.id }]);
});

it("records each source's run, failed or not, and keeps the jobs a successful check saved", async () => {
  fakeRequests({
    gov: async () => new Response("", { status: 503 }),
    ctfg: vi.fn().mockResolvedValueOnce(Response.json(ctfgFeed)).mockResolvedValueOnce(new Response("", { status: 429 })),
  });
  expect(await fetchEverySource(db)).toMatchObject([
    { source: "tech-jobs-for-gov", ok: false, error: "Tech Jobs for Gov API: HTTP 503" },
    { source: "civic-tech-field-guide", ok: true, seen: 2, new: 2 },
    { source: "diversify-tech", ok: false },
    { source: "tech-jobs-for-good", ok: false },
    { source: "diversify-tech-newsletter", ok: false },
  ]);
  expect(await fetchEverySource(db)).toMatchObject([
    { ok: false }, { source: "civic-tech-field-guide", ok: false, seen: 0, error: "Civic Tech Field Guide feed: HTTP 429" },
    { ok: false }, { ok: false }, { ok: false },
  ]);
  expect(await govRuns(db)).toHaveLength(2);
  expect(await ctfgRuns(db)).toHaveLength(2);
  expect(await db.select().from(jobs)).toHaveLength(2);
});

it("records skipped tagging when GEMINI_API_KEY is unset while the source check still saves jobs", async () => {
  const gov = vi.fn().mockResolvedValueOnce(Response.json([record]));
  fakeRequests({ gov });
  expect(await fetchEverySource(db)).toMatchObject([
    { source: "tech-jobs-for-gov", ok: true, new: 1 }, { ok: false }, { ok: false }, { ok: false }, { ok: false },
  ]);
  await tagUntaggedJobs(db);
  expect(fetch).toHaveBeenCalledTimes(5);
  expect(await taggingRuns(db)).toMatchObject([{ ok: false, seen: 0, new: 0, error: "GEMINI_API_KEY is not set; tagging skipped" }]);
  expect(logLines()).toContainEqual("[daily-check] tagging-skipped reason=missing-api-key");
  expect(await db.select().from(jobs)).toMatchObject([{ roleTags: null, taggedAt: null }]);
});

it("tags each new job once with a fake Gemini and leaves failed requests for the next run", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  const listings = [4296, 4297, 4298].map((id, day) => govListing(id, { date_gmt: `2026-10-0${day + 1}T00:00:00` }));
  const geminiAnswer = (fields: object) => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(fields) }] } }] });
  const gemini = vi.fn()
    .mockResolvedValueOnce(geminiAnswer({ roleTags: ["infrastructure-devops", "made-up"], sectorTags: ["general-government"], seniority: "senior", summary: "Runs cloud platforms for Louisiana." }))
    .mockResolvedValueOnce(new Response("", { status: 500 }))
    .mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts: [{ text: '{"roleTags": [' }] }, finishReason: "MAX_TOKENS" }] }))
    .mockResolvedValueOnce(geminiAnswer({ roleTags: ["security"], sectorTags: ["unknown"], seniority: "mid", summary: "Secures systems." }));
  fakeRequests({ gov: async () => Response.json(listings), gemini });
  const sleep = vi.fn(async () => {});

  await fetchThenTag(db, { sleep });
  const [firstRequest] = gemini.mock.calls[0]!;
  expect(firstRequest).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent");
  expect(gemini.mock.calls[0]![1].headers).toMatchObject({ "x-goog-api-key": "test-key" });
  expect(sleep.mock.calls).toEqual([[6_500], [6_500]]);
  expect(await taggingRuns(db)).toMatchObject([{ ok: false, seen: 3, new: 2, defaultedToUnknown: 1, error: "Gemini: HTTP 500" }]);
  const [jobA, jobB, jobC] = (await db.select().from(jobs).orderBy(jobs.postedAt)).map(job => job.id);
  expect(logLines()).toEqual([
    "[daily-check] source-start source=tech-jobs-for-gov",
    expect.stringMatching(/^\[daily-check\] source-done source=tech-jobs-for-gov ok=true fetched=3 saved=3 new=3 duration_ms=\d+$/),
    "[daily-check] source-start source=civic-tech-field-guide",
    expect.stringMatching(/^\[daily-check\] source-done source=civic-tech-field-guide ok=false fetched=0 saved=0 new=0 error="No listings found" duration_ms=\d+$/),
    "[daily-check] source-start source=diversify-tech",
    expect.stringMatching(/^\[daily-check\] source-done source=diversify-tech ok=false fetched=0 saved=0 new=0 error="No listings found" duration_ms=\d+$/),
    "[daily-check] source-start source=tech-jobs-for-good",
    expect.stringMatching(/^\[daily-check\] source-done source=tech-jobs-for-good ok=false fetched=0 saved=0 new=0 error="No listings found" duration_ms=\d+$/),
    "[daily-check] source-start source=diversify-tech-newsletter",
    expect.stringMatching(/^\[daily-check\] source-done source=diversify-tech-newsletter ok=false fetched=0 saved=0 new=0 error="No listings found" duration_ms=\d+$/),
    "[daily-check] tagging-start selected=3 cap=35",
    expect.stringMatching(new RegExp(`^\\[daily-check\\] tagging-job n=1/3 job_id=${jobA} outcome=tagged attempts=1 duration_ms=\\d+$`)),
    expect.stringMatching(new RegExp(`^\\[daily-check\\] tagging-job n=2/3 job_id=${jobB} outcome=transient-error status=500 error="Gemini: HTTP 500" attempts=1 duration_ms=\\d+$`)),
    expect.stringMatching(new RegExp(`^\\[daily-check\\] tagging-job n=3/3 job_id=${jobC} outcome=defaulted-to-unknown attempts=1 duration_ms=\\d+$`)),
    expect.stringMatching(/^\[daily-check\] tagging-done tagged=2 defaulted_to_unknown=1 transient_failures=1 duration_ms=\d+$/),
  ]);
  expect(logLines().join("\n")).not.toMatch(/test-key|Interested in advancing/);
  const byId = async () => {
    const saved = await db.select().from(jobs);
    return Object.fromEntries((await db.select().from(jobListings))
      .map(listing => [listing.sourceJobId, saved.find(job => job.id === listing.jobId)]));
  };
  expect(await byId()).toMatchObject({
    4296: { roleTags: ["infrastructure-devops"], sectorTags: ["general-government"], seniority: "senior", summary: "Runs cloud platforms for Louisiana." },
    4297: { roleTags: null, taggedAt: null },
    4298: { roleTags: ["unknown"], sectorTags: ["unknown"], seniority: "unknown", summary: null },
  });

  await fetchThenTag(db, { sleep });
  expect(gemini).toHaveBeenCalledTimes(4);
  expect((await taggingRuns(db))[1]).toMatchObject({ ok: true, seen: 1, new: 1, defaultedToUnknown: 0, error: null });
  expect((await byId())[4297]).toMatchObject({ roleTags: ["security"], sectorTags: ["unknown"], seniority: "mid" });

  await fetchThenTag(db, { sleep });
  expect(gemini).toHaveBeenCalledTimes(4);
  expect((await taggingRuns(db))[2]).toMatchObject({ ok: true, seen: 0, new: 0 });
});

it("stops tagging when the run's time budget runs low", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.useFakeTimers({ toFake: ["Date"] });
  const gemini = vi.fn().mockResolvedValue(Response.json({}));
  fakeRequests({ gov: async () => Response.json([record, govListing(2)]), gemini });
  await fetchThenTag(db, { sleep: async () => { vi.setSystemTime(Date.now() + 261_000); } });
  expect(gemini).toHaveBeenCalledOnce();
  expect(logLines()).toContainEqual("[daily-check] tagging-stopped reason=time-budget untagged=1");
  expect(await taggingRuns(db)).toMatchObject([{ ok: true, seen: 1, new: 1, defaultedToUnknown: 1 }]);
});

it.each([
  new TypeError("Connection reset"),
  new DOMException("Body aborted", "AbortError"),
  new DOMException("Body timed out", "TimeoutError"),
])("retries jobs after response body read failure: %s", async failure => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  const interrupted = new Response(new ReadableStream({
    start(controller) { controller.error(failure); },
  }));
  const gemini = vi.fn().mockResolvedValueOnce(interrupted).mockResolvedValueOnce(new Response("invalid JSON"));
  fakeRequests({ gov: async () => Response.json([record]), gemini });

  await fetchThenTag(db);
  expect(await db.select().from(jobs)).toMatchObject([{ taggedAt: null, roleTags: null }]);
  expect(await taggingRuns(db)).toMatchObject([{
    ok: false, seen: 1, new: 0, defaultedToUnknown: 0, error: failure.message,
  }]);
  expect(logLines()).toContainEqual(expect.stringMatching(/ outcome=transient-error error="[^"]+" attempts=1 duration_ms=\d+$/));

  await fetchThenTag(db);
  expect(gemini).toHaveBeenCalledTimes(2);
  expect((await taggingRuns(db))[1]).toMatchObject({
    ok: true, seen: 1, new: 1, defaultedToUnknown: 1, error: null,
  });
  expect(await db.select().from(jobs)).toMatchObject([{
    taggedAt: expect.any(Date), roleTags: ["unknown"], sectorTags: ["unknown"], seniority: "unknown",
  }]);
});

it.each([true, false])("does not count a skipped tag save when the answer is unusable: %s", async unusable => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  const tags = { roleTags: ["security"], sectorTags: ["education"], seniority: "senior", summary: "Secures schools." };
  fakeRequests({ gov: async () => Response.json([record]), gemini: async () => {
    const [pending] = await readJobsToTag(db, 1);
    await saveJobTags(db, pending!.id, tags);
    return Response.json(unusable ? {} : { candidates: [{ content: { parts: [{ text: JSON.stringify({
      ...tags, roleTags: ["software-engineering"],
    }) }] } }] });
  } });

  await fetchThenTag(db);
  expect(await taggingRuns(db)).toMatchObject([{
    ok: true, seen: 1, new: 0, defaultedToUnknown: 0, error: null,
  }]);
  expect(await db.select().from(jobs)).toMatchObject([tags]);
});

const taggedAnswer = () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({
  roleTags: ["security"], sectorTags: ["education"], seniority: "mid", summary: "Secures schools.",
}) }] } }] });

function fakeGeminiFor(listings: object[], gemini: () => Promise<Response>) {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  fakeRequests({ gov: async () => Response.json(listings), gemini });
}

const fourListings = [1, 2, 3, 4].map(id => govListing(id, { date_gmt: `2026-10-0${id}T00:00:00` }));

it.each([[429, "rate-limited"], [503, "overloaded"]])("retries twice, then stops tagging for the run after HTTP %i", async (status, reason) => {
  const gemini = vi.fn().mockResolvedValueOnce(taggedAnswer())
    .mockImplementation(async () => new Response("", { status }));
  fakeGeminiFor(fourListings, gemini);
  const sleep = vi.fn(async () => {});

  await fetchThenTag(db, { sleep });
  expect(gemini).toHaveBeenCalledTimes(4);
  expect(sleep.mock.calls).toEqual([[6_500], [30_000], [60_000]]);
  expect(await taggingRuns(db)).toMatchObject([{ ok: false, seen: 4, new: 1, defaultedToUnknown: 0, error: `Gemini: HTTP ${status}` }]);
  const [, second] = (await db.select().from(jobs).orderBy(jobs.postedAt)).map(job => job.id);
  expect((await db.select().from(jobs)).filter(job => job.taggedAt === null)).toHaveLength(3);
  expect(logLines()).toEqual(expect.arrayContaining([
    `[daily-check] tagging-retry job_id=${second} attempt=2 status=${status} wait_s=30`,
    `[daily-check] tagging-retry job_id=${second} attempt=3 status=${status} wait_s=60`,
    expect.stringMatching(new RegExp(`^\\[daily-check\\] tagging-job n=2/4 job_id=${second} outcome=transient-error status=${status} error="Gemini: HTTP ${status}" attempts=3 duration_ms=\\d+$`)),
    `[daily-check] tagging-stopped reason=${reason} status=${status} untagged=2`,
  ]));
  expect(logLines().at(-1)).toMatch(/^\[daily-check\] tagging-done tagged=1 defaulted_to_unknown=0 transient_failures=3 duration_ms=\d+$/);
});

it.each([429, 503].flatMap(status => [1, 2].map(retry => ({ status, retry }))))(
  "continues the backlog after HTTP $status recovers on retry $retry", async ({ status, retry }) => {
    const gemini = vi.fn();
    for (let attempt = 0; attempt < retry; attempt++) {
      gemini.mockResolvedValueOnce(new Response("", { status }));
    }
    gemini.mockImplementation(async () => taggedAnswer());
    fakeGeminiFor(fourListings.slice(0, 2), gemini);
    const sleep = vi.fn(async () => {});

    const { taggingRun, transientFailures } = await fetchThenTag(db, { sleep });
    expect(gemini).toHaveBeenCalledTimes(retry + 2);
    expect(sleep.mock.calls).toEqual(retry === 1 ? [[30_000], [6_500]] : [[30_000], [60_000], [6_500]]);
    expect(taggingRun).toMatchObject({ ok: true, seen: 2, new: 2, error: null });
    expect(transientFailures).toBe(0);
    expect(await readJobsToTag(db, 35)).toHaveLength(0);
  },
);

it.each([429, 503].flatMap(status => [1, 2].flatMap(retry =>
  ["http", "timeout", "transport", "body"].map(failure => ({ status, retry, failure })),
)))("stops after HTTP $status recovery ends in $failure on retry $retry", async ({ status, retry, failure }) => {
  const gemini = vi.fn();
  for (let attempt = 0; attempt < retry; attempt++) {
    gemini.mockResolvedValueOnce(new Response("", { status }));
  }
  const error = failure === "timeout" ? new DOMException("Timed out", "TimeoutError") : new TypeError("Connection reset");
  if (failure === "http") {
    gemini.mockResolvedValueOnce(new Response("", { status: 500 }));
  } else if (failure === "body") {
    gemini.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) { controller.error(error); },
    })));
  } else {
    gemini.mockRejectedValueOnce(error);
  }
  gemini.mockImplementation(async () => taggedAnswer());
  fakeGeminiFor(fourListings, gemini);
  const sleep = vi.fn(async () => {});

  const { taggingRun, transientFailures } = await fetchThenTag(db, { sleep });
  expect(gemini).toHaveBeenCalledTimes(retry + 1);
  expect(sleep.mock.calls).toEqual(retry === 1 ? [[30_000]] : [[30_000], [60_000]]);
  expect(taggingRun).toMatchObject({
    ok: false, seen: 4, new: 0, defaultedToUnknown: 0,
    error: failure === "http" ? "Gemini: HTTP 500" : error.message,
  });
  expect(transientFailures).toBe(4);
  expect(await readJobsToTag(db, 35)).toHaveLength(4);
  expect(logLines()).toContainEqual(
    `[daily-check] tagging-stopped reason=${status === 429 ? "rate-limited" : "overloaded"} status=${status} untagged=3`,
  );
});

it("stops instead of starting a retry wait that would run past the time budget", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const gemini = vi.fn().mockImplementation(async () => {
    vi.setSystemTime(Date.now() + 240_000);
    return new Response("", { status: 503 });
  });
  fakeGeminiFor(fourListings.slice(0, 2), gemini);
  const sleep = vi.fn(async () => {});

  await fetchThenTag(db, { sleep });
  expect(gemini).toHaveBeenCalledOnce();
  expect(sleep).not.toHaveBeenCalled();
  expect(await taggingRuns(db)).toMatchObject([{ ok: false, seen: 2, new: 0, error: "Gemini: HTTP 503" }]);
  expect(logLines()).toContainEqual(expect.stringMatching(/ tagging-retry-skipped job_id=\S+ status=503 wait_s=30 reason=time-budget$/));
  expect(logLines()).toContainEqual("[daily-check] tagging-stopped reason=overloaded status=503 untagged=1");
});
