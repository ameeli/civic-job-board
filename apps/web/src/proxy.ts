import { NextResponse, type NextRequest } from "next/server";
import { allowedSession, getAuth } from "@/lib/auth";

// Everything else requires a signed-in, allowed session.
const PUBLIC_PATHS = new Set(["/sign-in", "/api/cron/daily"]);
const PUBLIC_PREFIXES = ["/api/auth/"];

export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.has(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

/**
 * Protects every page and API route by default. Pages redirect to the sign-in
 * page; API routes answer 401. The daily cron route stays reachable and keeps
 * its own CRON_SECRET check.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const { headers, response: session } = await getAuth().api.getSession({
    headers: request.headers,
    returnHeaders: true,
  });

  let response: NextResponse;
  if (allowedSession(session)) {
    response = NextResponse.next();
  } else if (pathname.startsWith("/api/")) {
    response = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  } else {
    response = NextResponse.redirect(new URL("/sign-in", request.url));
  }

  // Passes on refreshed or cleared session cookies from the session check.
  for (const cookie of headers.getSetCookie()) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}

export const config = {
  // Skips only Next.js build assets; every route goes through the check above.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
