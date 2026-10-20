/**
 * The subset of `fetch` the source adapters use. The global `fetch` of Node,
 * browsers, and edge runtimes all satisfy it, and tests pass a fake.
 */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  url: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface HttpResponse {
  status: number;
  /** The final URL after redirects. */
  url: string;
  headers: { get(name: string): string | null };
  body: string;
}

export interface HttpClient {
  /** GETs a URL and returns its body; throws `HttpError` unless the status is 2xx. */
  get(url: string, options?: { accept?: string }): Promise<HttpResponse>;
}

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpError";
  }
}

export const USER_AGENT =
  "civic-job-board/1.0 (+https://github.com/ameeli/civic-job-board)";

export interface HttpClientOptions {
  fetch: FetchLike;
  userAgent?: string;
  /** Per-request timeout. */
  timeoutMs?: number;
  /**
   * Minimum gap between two requests to the same host, by host name. Used to
   * honour a site's robots.txt `Crawl-delay`.
   */
  hostDelayMs?: Record<string, number>;
  /** Gap used for hosts not listed in `hostDelayMs`. */
  defaultHostDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** A polite HTTP client: identifies itself, times out, and spaces requests per host. */
export function createHttpClient(options: HttpClientOptions): HttpClient {
  const {
    fetch,
    userAgent = USER_AGENT,
    timeoutMs = 20_000,
    hostDelayMs = {},
    defaultHostDelayMs = 250,
    sleep = defaultSleep,
    now = Date.now,
  } = options;
  const lastRequestAt = new Map<string, number>();

  return {
    async get(url, { accept } = {}) {
      const host = new URL(url).host;
      const gap = hostDelayMs[host] ?? defaultHostDelayMs;
      const last = lastRequestAt.get(host);
      if (last !== undefined) {
        const wait = last + gap - now();
        if (wait > 0) {
          await sleep(wait);
        }
      }
      lastRequestAt.set(host, now());

      const headers: Record<string, string> = { "user-agent": userAgent };
      if (accept) {
        headers.accept = accept;
      }
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new HttpError(url, response.status);
      }
      return {
        status: response.status,
        url: response.url || url,
        headers: response.headers,
        body: await response.text(),
      };
    },
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
