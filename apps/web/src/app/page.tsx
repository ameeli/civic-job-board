import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAllowedSession } from "@/lib/auth";
import { signOut } from "./actions";

export default async function HomePage() {
  // The proxy already requires a session; this keeps the page safe on its own.
  const session = await getAllowedSession(await headers());
  if (!session) {
    redirect("/sign-in");
  }

  return (
    <>
      <header className="site-header">
        <h1 className="site-title">Civic Job Board</h1>
        <div className="account">
          <span className="account-email">
            Signed in as {session.user.email}
          </span>
          <form action={signOut}>
            <button type="submit" className="button button-quiet">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="home">
        <h2>Inbox coming soon</h2>
        <p>The inbox is still being designed.</p>
      </main>
    </>
  );
}
