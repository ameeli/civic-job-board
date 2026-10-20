import type { FetchLike, NormalizedJob, SourceAdapter } from "@civic-job-board/core";
import { acquireLease, aiQueue, jobTags, jobs, sourceRuns, type Db } from "@civic-job-board/db";
import { createTestDb } from "@civic-job-board/db/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runDailyCheck } from "./daily-check";

const NOW = new Date("2026-10-20T13:00:00Z");

function job(id: string, title: string): NormalizedJob {
  return {
    externalId: id,
    sourceUrl: `https://board.example/jobs/${id}`,
    title,
    orgName: "Civic Org",
    orgWebsite: null,
    location: "Remote",
    remoteType: "remote",
    salary: null,
    description: "Public posting text.",
    applyUrl: `https://board.example/apply/${id}`,
    postedAt: null,
    expiresAt: null,
    boardTags: [],
  };
}

function source(id: string, fetchJobs: SourceAdapter["fetchJobs"]): SourceAdapter {
  return { id, name: id, fetchJobs: vi.fn(fetchJobs) };
}

const boardA = () =>
  source("board-a", async () => ({ jobs: [job("1", "Data Engineer"), job("2", "Policy Lead")], listedIds: ["1", "2"], partial: false }));
const broken = () =>
  source("broken", async () => {
    throw new Error("HTTP 503 for https://broken.example/feed");
  });

/** A fake Gemini that tags every job it is sent. */
function gemini(status = 200) {
  return vi.fn<FetchLike>(async (_url, init) => {
    const input = JSON.parse(init!.body!).input as string;
    const ids = [...input.matchAll(/"id": "(\d+)"/g)].map((m) => m[1]);
    const output = {
      jobs: ids.map((id) => ({
        id,
        job_function: "Data/Analytics",
        job_function_confidence: 0.8,
        sectors: [{ sector: "Government/Public sector", confidence: 0.9 }],
        seniority: "Mid",
        summary: `Summary of job ${id}.`,
        organization: "",
      })),
    };
    const body =
      status === 200
        ? JSON.stringify({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(output) }] }] })
        : '{"error":{"code":429}}';
    return { ok: status === 200, status, url: "", headers: { get: () => null }, text: async () => body };
  });
}

describe("runDailyCheck", () => {
  let db: Db;
  let clock: number;
  const now = () => new Date(clock);
  const sleep = vi.fn(async (ms: number) => {
    clock += ms;
  });

  beforeEach(async () => {
    db = await createTestDb();
    clock = NOW.getTime();
    sleep.mockClear();
  });

  const options = (overrides: Partial<Parameters<typeof runDailyCheck>[0]> = {}) => ({
    db,
    fetch: gemini(),
    deadline: new Date(NOW.getTime() + 270_000),
    geminiApiKey: "key",
    now,
    sleep,
    ...overrides,
  });

  it("checks every source, records one run each, and tags the new jobs", async () => {
    const fetch = gemini();
    const summary = await runDailyCheck(options({ fetch, sources: [boardA(), broken()] }));

    expect(summary).toMatchObject({
      status: "done",
      sources: [
        { source: "board-a", ok: true, seen: 2, new: 2, partial: false },
        { source: "broken", ok: false, seen: 0, new: 0, error: "HTTP 503 for https://broken.example/feed" },
      ],
      ai: { tagged: 2, failed: 0, stopped: null },
      moreWork: false,
    });
    const runs = await db.select().from(sourceRuns);
    expect(runs.map((run) => [run.source, run.ok, run.seen, run.new, run.error])).toEqual([
      ["board-a", true, 2, 2, null],
      ["broken", false, 0, 0, "HTTP 503 for https://broken.example/feed"],
    ]);
    expect(await db.select().from(aiQueue)).toEqual([]);
    expect((await db.select().from(jobs)).map((j) => j.summary).sort()).toEqual(["Summary of job 1.", "Summary of job 2."]);
    expect((await db.select().from(jobTags)).filter((t) => t.axis === "function")).toHaveLength(2);
    // Only public posting fields go to Gemini.
    const sent = JSON.parse(fetch.mock.calls[0]![1]!.body!);
    expect(Object.keys(JSON.parse(sent.input.slice(sent.input.indexOf("[")))[0]).sort()).toEqual([
      "board_categories", "description", "id", "location", "organization", "title",
    ]);
  });

  it("does nothing more when delivered twice", async () => {
    const sources = [boardA(), broken()];
    await runDailyCheck(options({ sources }));
    clock += 60_000;
    const fetch = gemini();

    const second = await runDailyCheck(options({ sources, fetch }));

    expect(second.sources).toEqual([]);
    expect(sources[0]!.fetchJobs).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(await db.select().from(sourceRuns)).toHaveLength(2);
  });

  it("skips the run while another holds the lease", async () => {
    await acquireLease(db, { name: "daily-check", holder: "other", expiresAt: new Date(NOW.getTime() + 300_000), now: NOW });
    const sources = [boardA()];

    expect(await runDailyCheck(options({ sources }))).toMatchObject({ status: "busy", sources: [] });
    expect(sources[0]!.fetchJobs).not.toHaveBeenCalled();
  });

  it("skips AI without a key and leaves the jobs queued", async () => {
    const summary = await runDailyCheck(options({ sources: [boardA()], geminiApiKey: undefined }));

    expect(summary.ai).toEqual({ tagged: 0, failed: 0, stopped: "no-key" });
    expect(summary.moreWork).toBe(false);
    expect(await db.select().from(aiQueue)).toHaveLength(2);
  });

  it("stops at Gemini's rate limit and keeps the queue for the next run", async () => {
    const summary = await runDailyCheck(options({ sources: [boardA()], fetch: gemini(429) }));

    expect(summary.ai).toEqual({ tagged: 0, failed: 0, stopped: "rate-limited" });
    expect((await db.select().from(aiQueue)).map((row) => row.attempts)).toEqual([0, 0]);
  });

  it("paces Gemini requests and reports work left when time runs out", async () => {
    const many = source("many", async () => {
      const list = Array.from({ length: 12 }, (_, i) => job(String(i + 1), `Job ${i + 1}`));
      return { jobs: list, listedIds: list.map((j) => j.externalId), partial: false };
    });
    // Past the 45 s kept back from sources, time for two requests six seconds apart but not a third.
    const deadline = new Date(NOW.getTime() + 46_000);

    const summary = await runDailyCheck(options({ sources: [many], deadline, aiRequestsPerMinute: 10 }));

    expect(summary.ai.tagged).toBe(10);
    expect(sleep).toHaveBeenCalledWith(6_000);
    expect(summary.moreWork).toBe(true);
  });

  it("reports a partial source check as more work and continues it next run", async () => {
    let calls = 0;
    const slow = source("slow", async () => {
      calls++;
      return { jobs: [job(String(calls), `Job ${calls}`)], listedIds: ["1", "2"], partial: calls === 1 };
    });

    const first = await runDailyCheck(options({ sources: [slow] }));
    const second = await runDailyCheck(options({ sources: [slow] }));
    const third = await runDailyCheck(options({ sources: [slow] }));

    expect(first).toMatchObject({ moreWork: true, sources: [{ partial: true }] });
    expect(second).toMatchObject({ moreWork: false, sources: [{ partial: false }] });
    expect(third.sources).toEqual([]);
  });
});
