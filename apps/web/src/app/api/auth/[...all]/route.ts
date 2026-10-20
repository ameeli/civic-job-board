import { getAuth } from "@/lib/auth";

// Better Auth's endpoints: Google sign-in start and callback, session, sign-out.
export function GET(request: Request): Promise<Response> {
  return getAuth().handler(request);
}

export function POST(request: Request): Promise<Response> {
  return getAuth().handler(request);
}
