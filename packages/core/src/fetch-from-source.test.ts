import { expect, it, vi } from "vitest";
import { fetchFromSource } from "./fetch-from-source";

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
