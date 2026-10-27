import { readFileSync } from "node:fs";
import { HttpError, type HttpClient } from "../http";
import type { KnownJob, SourceContext } from "../jobs";

/** For tests: one canned response, from a fixture file or inline. */
export interface FakeRoute {
  fixture?: string;
  body?: string;
  status?: number;
  headers?: Record<string, string>;
}

/** For tests: an HttpClient that serves fixtures by exact URL and fails on anything else. */
export function fakeHttp(
  routes: Record<string, FakeRoute>,
  /** Served for any other URL; without it, other URLs fail the test. */
  fallback?: FakeRoute,
): HttpClient & { requested: string[] } {
  const requested: string[] = [];
  return {
    requested,
    async get(url) {
      requested.push(url);
      const route = routes[url] ?? fallback;
      if (!route) {
        throw new Error(`Unexpected request: ${url}`);
      }
      const status = route.status ?? 200;
      if (status < 200 || status >= 300) {
        throw new HttpError(url, status);
      }
      const headers = new Map(Object.entries(route.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
      return {
        status,
        url,
        headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
        body: route.fixture
          ? readFileSync(new URL(`./fixtures/${route.fixture}`, import.meta.url), "utf8")
          : (route.body ?? ""),
      };
    },
  };
}

export const TEST_NOW = new Date("2026-10-20T13:00:00Z");

/** For tests: a context with the given known jobs and no deadline pressure. */
export function testContext(
  http: HttpClient,
  known: Record<string, KnownJob> = {},
  overrides: Partial<SourceContext> = {},
): SourceContext {
  return {
    http,
    now: TEST_NOW,
    known: new Map(Object.entries(known)),
    deadline: new Date(Date.now() + 60_000),
    ...overrides,
  };
}
