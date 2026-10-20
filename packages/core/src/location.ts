import type { RemoteType } from "./jobs";

/**
 * Reads the remote/hybrid/on-site arrangement from text such as
 * `Alameda, CA (Hybrid)`, `Remote - US`, or a board's `In-office` label.
 */
export function parseRemoteType(text: string | null | undefined): RemoteType | null {
  if (!text) {
    return null;
  }
  const t = text.toLowerCase();
  if (/\bhybrid\b/.test(t)) return "hybrid";
  if (/\b(remote|telecommute|work from home|wfh|distributed|anywhere)\b/.test(t)) return "remote";
  if (/\b(on[- ]?site|in[- ]?office|in[- ]?person)\b/.test(t)) return "onsite";
  return null;
}
