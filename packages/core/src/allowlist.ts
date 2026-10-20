/**
 * Decides whether a Google account may sign in: only the single address in
 * `ALLOWED_EMAIL`, compared case-insensitively. Rejects everything when no
 * address is configured, so a missing env var never opens sign-in to anyone.
 */
export function isAllowedEmail(
  email: string | null | undefined,
  allowedEmail: string | undefined,
): boolean {
  const allowed = normalizeEmail(allowedEmail);
  if (!allowed || !email) {
    return false;
  }
  return normalizeEmail(email) === allowed;
}

function normalizeEmail(email: string | undefined): string {
  return (email ?? "").trim().toLowerCase();
}
