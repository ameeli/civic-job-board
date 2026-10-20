import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getAuth: () => ({ api: { getSession } }),
}));
vi.mock("@/lib/db", () => ({ getDb: () => "fake-db" }));

import { config, isPublicPath, proxy } from "./proxy";

const allowedEmail = "owner@gmail.com";

function signedInAs(email: string | null, setCookies: string[] = []) {
  const headers = new Headers();
  for (const cookie of setCookies) {
    headers.append("set-cookie", cookie);
  }
  getSession.mockResolvedValue({
    headers,
    response: email ? { user: { email }, session: {} } : null,
  });
}

function request(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`);
}

describe("proxy", () => {
  beforeEach(() => {
    vi.stubEnv("ALLOWED_EMAIL", allowedEmail);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    getSession.mockReset();
  });

  it("redirects a signed-out visitor from a page to the sign-in page", async () => {
    signedInAs(null);

    const response = await proxy(request("/"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/sign-in");
  });

  it("redirects signed-out visitors from any page, not just the home page", async () => {
    signedInAs(null);

    const response = await proxy(request("/jobs/123?tab=notes"));

    expect(response.headers.get("location")).toBe("http://localhost:3000/sign-in");
  });

  it("answers 401 to a signed-out API request", async () => {
    signedInAs(null);

    const response = await proxy(request("/api/jobs"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("lets the allowed user through", async () => {
    signedInAs(allowedEmail);

    const page = await proxy(request("/"));
    const api = await proxy(request("/api/jobs"));

    expect(page.headers.get("x-middleware-next")).toBe("1");
    expect(api.headers.get("x-middleware-next")).toBe("1");
  });

  it("treats a session of an address that is no longer allowed as signed out", async () => {
    signedInAs("previous-owner@gmail.com");

    const response = await proxy(request("/"));

    expect(response.headers.get("location")).toBe("http://localhost:3000/sign-in");
  });

  it("passes on session cookies refreshed by the session check", async () => {
    signedInAs(allowedEmail, ["better-auth.session_token=new; Path=/; HttpOnly"]);

    const response = await proxy(request("/"));

    expect(response.headers.getSetCookie()).toEqual([
      "better-auth.session_token=new; Path=/; HttpOnly",
    ]);
  });

  it.each(["/sign-in", "/api/auth/callback/google", "/api/auth/get-session", "/api/cron/daily"])(
    "leaves %s public without checking for a session",
    async (path) => {
      const response = await proxy(request(path));

      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(getSession).not.toHaveBeenCalled();
    },
  );
});

describe("isPublicPath", () => {
  it("does not open look-alike paths", () => {
    expect(isPublicPath("/api/authx")).toBe(false);
    expect(isPublicPath("/api/auth")).toBe(false);
    expect(isPublicPath("/sign-in/extra")).toBe(false);
    expect(isPublicPath("/api/cron/daily/extra")).toBe(false);
    expect(isPublicPath("/api/cron/other")).toBe(false);
  });
});

describe("proxy matcher", () => {
  it.each(["/", "/sign-in", "/api/jobs", "/api/cron/daily", "/jobs/123"])(
    "runs the proxy on %s",
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
    },
  );

  it.each(["/_next/static/chunks/app.js", "/_next/image?url=x", "/favicon.ico"])(
    "skips the Next.js asset %s",
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
    },
  );
});
