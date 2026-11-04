import { expect, it, vi } from "vitest";
import { fetchFromSource, fetchPageTexts } from "./fetch-from-source";

it("GETs the URL uncached with a timeout and returns a successful response", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: 1 }));
  const response = await fetchFromSource("Example board", "https://example.org/jobs", fetcher);
  expect(await response.json()).toEqual({ ok: 1 });
  expect(fetcher).toHaveBeenCalledWith("https://example.org/jobs", {
    signal: expect.any(AbortSignal), cache: "no-store",
  });
});

it("names the board and the status when the board answers with an error", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
  await expect(fetchFromSource("Example board", "https://example.org/jobs", fetcher))
    .rejects.toThrow(new Error("Example board: HTTP 429"));
});

it("passes network failures through unchanged", async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
  await expect(fetchFromSource("Example board", "https://example.org/jobs", fetcher))
    .rejects.toThrow(new TypeError("fetch failed"));
});

it("fetches pages one at a time, each a delay after the previous request, and stops at a failure", async () => {
  const order: string[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    order.push(url);
    return new Response(url.endsWith("/3") ? "" : `page ${url.slice(-1)}`, { status: url.endsWith("/3") ? 404 : 200 });
  });
  const sleep = vi.fn(async (ms: number) => { order.push(`sleep ${ms}`); });
  const urls = ["https://example.org/1", "https://example.org/2"];
  expect(await fetchPageTexts("Example board", urls, 1_000, fetcher, sleep)).toEqual(["page 1", "page 2"]);
  expect(order).toEqual(["sleep 1000", urls[0], "sleep 1000", urls[1]]);
  await expect(fetchPageTexts("Example board", ["https://example.org/3", ...urls], 0, fetcher, sleep))
    .rejects.toThrow("Example board: HTTP 404");
  expect(fetcher).toHaveBeenCalledTimes(3);
});
