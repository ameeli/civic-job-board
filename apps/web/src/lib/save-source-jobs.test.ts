import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { jobs, sourceRuns, type Db } from "@civic-job-board/db";
import { createTestDb } from "@civic-job-board/db/testing";
import { saveSourceJobs } from "./save-source-jobs";

let db: Db;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  db = await createTestDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const toJob = (id: string) => ({
  source: "example-board", sourceJobId: id, title: `Job ${id}`, description: "",
  sourceUrl: `https://example.org/jobs/${id}`,
});
const logLines = () => vi.mocked(console.log).mock.calls.map(([line]) => String(line));

it("saves each listing, counts only new jobs, and records the source's run", async () => {
  expect(await saveSourceJobs(db, "example-board", async () => ["a", "b"], toJob))
    .toMatchObject({ source: "example-board", ok: true, seen: 2, new: 2, error: null });
  expect(await saveSourceJobs(db, "example-board", async () => ["b", "c"], toJob))
    .toMatchObject({ ok: true, seen: 2, new: 1 });
  expect((await db.select().from(jobs)).map(job => job.sourceJobId).sort()).toEqual(["a", "b", "c"]);
  expect(await db.select().from(sourceRuns)).toHaveLength(2);
  expect(logLines()).toContainEqual(expect.stringMatching(
    /^\[daily-check\] source-done source=example-board ok=true fetched=2 saved=2 new=1 duration_ms=\d+$/,
  ));
});

it("records a failed fetch instead of throwing", async () => {
  const run = await saveSourceJobs(db, "example-board", async () => { throw new Error("Example: HTTP 503"); }, toJob);
  expect(run).toMatchObject({ ok: false, seen: 0, new: 0, error: "Example: HTTP 503" });
  expect(logLines()).toContainEqual(expect.stringMatching(/ ok=false fetched=0 saved=0 new=0 error="Example: HTTP 503" duration_ms=\d+$/));
});

it("keeps earlier saves when a later listing fails to map", async () => {
  const mapJob = (id: string) => {
    if (id === "bad") throw new Error("Invalid example listing");
    return toJob(id);
  };
  expect(await saveSourceJobs(db, "example-board", async () => ["a", "bad", "c"], mapJob))
    .toMatchObject({ ok: false, seen: 3, new: 1, error: "Invalid example listing" });
  expect((await db.select().from(jobs)).map(job => job.sourceJobId)).toEqual(["a"]);
});
