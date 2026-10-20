import { accounts, sessions, users, type Db } from "@civic-job-board/db";
import { createTestDb } from "@civic-job-board/db/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allowedSession, createAuth, type Auth, type Session } from "./auth";

vi.mock("./db", () => ({
  getDb: () => {
    throw new Error("tests pass their own database to createAuth");
  },
}));

const baseURL = "http://localhost:3000";
const allowedEmail = "owner@gmail.com";

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/**
 * Stands in for Google's token endpoint. Better Auth reads the profile from
 * the id token it receives there, so this decides who "signs in".
 */
function googleReturns(profile: { email: string; email_verified: boolean }) {
  const idToken = [
    base64url({ alg: "RS256", typ: "JWT" }),
    base64url({
      iss: "https://accounts.google.com",
      aud: "test-client-id",
      sub: `google-${profile.email}`,
      name: "Test Person",
      picture: "https://example.com/avatar.png",
      ...profile,
    }),
    "signature",
  ].join(".");

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (!url.startsWith("https://oauth2.googleapis.com/token")) {
        throw new Error(`Unexpected fetch in test: ${url}`);
      }
      return Response.json({
        access_token: "google-access-token",
        id_token: idToken,
        expires_in: 3600,
        token_type: "Bearer",
        scope: "openid email profile",
      });
    }),
  );
}

function cookieHeader(setCookies: string[]): string {
  return setCookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

/**
 * Runs the whole Google sign-in round trip through Better Auth: start sign-in
 * (as the sign-in button does), then call the OAuth callback the way Google's
 * redirect would. Returns where the browser is sent next.
 */
async function signInWithGoogle(auth: Auth) {
  const { headers, response } = await auth.api.signInSocial({
    body: { provider: "google", callbackURL: "/", errorCallbackURL: "/sign-in" },
    returnHeaders: true,
  });
  const state = new URL(response.url ?? "").searchParams.get("state");
  expect(state).toBeTruthy();

  const callback = await auth.handler(
    new Request(
      `${baseURL}/api/auth/callback/google?code=test-code&state=${state}`,
      { headers: { cookie: cookieHeader(headers.getSetCookie()) } },
    ),
  );
  return {
    status: callback.status,
    location: callback.headers.get("location"),
    setCookies: callback.headers.getSetCookie(),
  };
}

describe("Google sign-in allowlist", () => {
  let db: Db;
  let auth: Auth;

  beforeEach(async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-that-is-at-least-32-chars");
    vi.stubEnv("BETTER_AUTH_URL", baseURL);
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-client-secret");
    vi.stubEnv("ALLOWED_EMAIL", allowedEmail);
    db = await createTestDb();
    auth = createAuth(db);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("signs in the allowed account, matching its address case-insensitively", async () => {
    googleReturns({ email: "Owner@Gmail.com", email_verified: true });

    const result = await signInWithGoogle(auth);

    expect(result.status).toBe(302);
    expect(result.location).toBe("/");
    const [user] = await db.select().from(users);
    expect(user).toMatchObject({ email: allowedEmail, emailVerified: true });
    expect(await db.select().from(accounts)).toHaveLength(1);
    expect(await db.select().from(sessions)).toHaveLength(1);

    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookieHeader(result.setCookies) }),
    });
    expect(session?.user.email).toBe(allowedEmail);
  });

  it("refuses any other account without storing it", async () => {
    googleReturns({ email: "someone.else@gmail.com", email_verified: true });

    const result = await signInWithGoogle(auth);

    expect(result.status).toBe(302);
    expect(result.location).toMatch(/^\/sign-in\?error=EMAIL_NOT_ALLOWED(&|$)/);
    expect(await db.select().from(users)).toEqual([]);
    expect(await db.select().from(accounts)).toEqual([]);
    expect(await db.select().from(sessions)).toEqual([]);
  });

  it("refuses the allowed address when Google has not verified it", async () => {
    googleReturns({ email: allowedEmail, email_verified: false });

    const result = await signInWithGoogle(auth);

    expect(result.location).toMatch(/^\/sign-in\?error=EMAIL_NOT_ALLOWED(&|$)/);
    expect(await db.select().from(users)).toEqual([]);
  });

  it("refuses everyone when ALLOWED_EMAIL is unset", async () => {
    vi.stubEnv("ALLOWED_EMAIL", "");
    googleReturns({ email: allowedEmail, email_verified: true });

    const result = await signInWithGoogle(auth);

    expect(result.location).toMatch(/^\/sign-in\?error=EMAIL_NOT_ALLOWED(&|$)/);
    expect(await db.select().from(users)).toEqual([]);
  });

  it("refuses a stored user whose address is no longer the allowed one", async () => {
    googleReturns({ email: allowedEmail, email_verified: true });
    await signInWithGoogle(auth);
    await db.delete(sessions);
    vi.stubEnv("ALLOWED_EMAIL", "new-owner@gmail.com");

    const result = await signInWithGoogle(auth);

    expect(result.location).toMatch(/^\/sign-in\?error=EMAIL_NOT_ALLOWED(&|$)/);
    expect(await db.select().from(sessions)).toEqual([]);
  });
});

describe("allowedSession", () => {
  const session = { user: { email: allowedEmail } } as Session;

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps a session of the allowed address", () => {
    vi.stubEnv("ALLOWED_EMAIL", "OWNER@gmail.com");
    expect(allowedSession(session)).toBe(session);
  });

  it("drops a session once ALLOWED_EMAIL names someone else", () => {
    vi.stubEnv("ALLOWED_EMAIL", "new-owner@gmail.com");
    expect(allowedSession(session)).toBeNull();
  });

  it("drops a missing session", () => {
    vi.stubEnv("ALLOWED_EMAIL", allowedEmail);
    expect(allowedSession(null)).toBeNull();
  });
});
