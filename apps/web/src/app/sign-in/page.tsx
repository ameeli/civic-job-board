import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { EMAIL_NOT_ALLOWED, getAllowedSession } from "@/lib/auth";
import { signInWithGoogle } from "../actions";

export const metadata: Metadata = { title: "Sign in · Civic Job Board" };

// Better Auth redirects here with `?error=<code>` when sign-in fails.
function errorMessage(code: string | undefined): string | null {
  if (!code) {
    return null;
  }
  if (code === EMAIL_NOT_ALLOWED) {
    return "That Google account is not allowed to sign in. This job board only accepts its owner's account.";
  }
  if (code === "access_denied") {
    return "Google sign-in was cancelled.";
  }
  return "Sign-in did not finish. Please try again.";
}

export default async function SignInPage({
  searchParams,
}: PageProps<"/sign-in">) {
  if (await getAllowedSession(await headers())) {
    redirect("/");
  }

  const { error } = await searchParams;
  const message = errorMessage(typeof error === "string" ? error : undefined);

  return (
    <main className="sign-in">
      <div className="sign-in-card">
        <div className="sign-in-intro">
          <h1>Civic Job Board</h1>
          <p>
            One inbox for civic tech and{" "}
            <span className="nowrap">tech-for-good</span> jobs.
          </p>
        </div>
        {message && (
          <p className="alert" role="alert">
            {message}
          </p>
        )}
        <form action={signInWithGoogle} className="sign-in-form">
          <button type="submit" className="button button-primary">
            Sign in with Google
          </button>
        </form>
        <p className="sign-in-note">Private board: only the owner can sign in.</p>
      </div>
    </main>
  );
}
