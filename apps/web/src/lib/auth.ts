import { isAllowedEmail } from "@civic-job-board/core";
import { authSchema, findUserById, type Db } from "@civic-job-board/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "./db";

/**
 * Error code the sign-in page receives (as `?error=`) when a Google account
 * other than `ALLOWED_EMAIL` tries to sign in.
 */
export const EMAIL_NOT_ALLOWED = "EMAIL_NOT_ALLOWED";

// Where Better Auth sends the browser when sign-in fails; the page reads `?error=`.
const SIGN_IN_PATH = "/sign-in";

function refuseSignIn(): never {
  throw new APIError("FORBIDDEN", {
    code: EMAIL_NOT_ALLOWED,
    message: "This Google account is not allowed to sign in.",
  });
}

/**
 * Builds the Better Auth instance. Only Google sign-in is enabled, and only
 * for the address in `ALLOWED_EMAIL`: any other account is refused before
 * its user row is written, so no account or session is ever stored for it.
 */
export function createAuth(db: Db) {
  return betterAuth({
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: authSchema,
      usePlural: true,
    }),
    advanced: {
      // Postgres generates the uuid primary keys (see packages/db/src/schema.ts).
      database: { generateId: "uuid" },
    },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID ?? "",
        clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        // Always show Google's account chooser, so signing in with the right
        // account does not depend on which one the browser used last.
        prompt: "select_account",
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      // Signed copy of the session in a cookie, so most requests skip the database.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    onAPIError: { errorURL: SIGN_IN_PATH },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (
              !user.emailVerified ||
              !isAllowedEmail(user.email, process.env.ALLOWED_EMAIL)
            ) {
              refuseSignIn();
            }
          },
        },
      },
      session: {
        create: {
          // Also covers a user row created while a different address was allowed.
          before: async (session) => {
            const user = await findUserById(db, session.userId);
            if (!isAllowedEmail(user?.email, process.env.ALLOWED_EMAIL)) {
              refuseSignIn();
            }
          },
        },
      },
    },
    // Lets server actions set and clear the session cookies; must stay last.
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;

let auth: Auth | undefined;

/** Lazily creates the app's Better Auth instance on first use. */
export function getAuth(): Auth {
  auth ??= createAuth(getDb());
  return auth;
}

/**
 * Returns the request's session if it belongs to the allowed address, and
 * null otherwise. Checking the address on every request means changing
 * `ALLOWED_EMAIL` locks out an existing session immediately.
 */
export function allowedSession(session: Session | null): Session | null {
  if (!session || !isAllowedEmail(session.user.email, process.env.ALLOWED_EMAIL)) {
    return null;
  }
  return session;
}

/** The signed-in, allowed session for a server component or server action. */
export async function getAllowedSession(headers: Headers): Promise<Session | null> {
  return allowedSession(await getAuth().api.getSession({ headers }));
}
