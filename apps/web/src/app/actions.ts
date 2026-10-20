"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";

export async function signInWithGoogle(): Promise<void> {
  const { url } = await getAuth().api.signInSocial({
    body: {
      provider: "google",
      callbackURL: "/",
      errorCallbackURL: "/sign-in",
    },
    headers: await headers(),
  });
  if (!url) {
    throw new Error("Better Auth returned no Google sign-in URL");
  }
  redirect(url);
}

export async function signOut(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/sign-in");
}
