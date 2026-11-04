/** A job board that does not answer within this long fails that source's check. */
const SOURCE_TIMEOUT_MS = 20_000;

/**
 * GETs one URL from a job board, uncached and with a timeout. Any non-2xx answer
 * throws `<board name>: HTTP <status>`, which becomes the source run's error.
 */
export async function fetchFromSource(boardName: string, url: string, fetcher = fetch): Promise<Response> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS), cache: "no-store" });
  if (!response.ok) throw new Error(`${boardName}: HTTP ${response.status}`);
  return response;
}
