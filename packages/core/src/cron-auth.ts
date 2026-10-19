/**
 * Checks the `Authorization` header Vercel sends on cron invocations
 * (`Bearer <CRON_SECRET>`). Rejects everything when no secret is configured,
 * so a missing env var never leaves the endpoint open.
 */
export function isAuthorizedCronRequest(
  authorizationHeader: string | null,
  cronSecret: string | undefined,
): boolean {
  if (!cronSecret || authorizationHeader === null) {
    return false;
  }
  return constantTimeEqual(authorizationHeader, `Bearer ${cronSecret}`);
}

// Runtime-agnostic (no node:crypto) comparison that does not short-circuit on
// the first differing character.
function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
