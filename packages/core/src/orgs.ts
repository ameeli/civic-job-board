const LEGAL_SUFFIXES =
  /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|pbc|plc|gmbh|lp|llp)\b\.?/g;

/**
 * A key for matching one employer's differently written names: lowercase,
 * no accents, punctuation, legal suffixes, or a leading "the".
 * `The Raft, LLC` and `raft` share the key `raft`.
 */
export function orgNameKey(name: string): string {
  const key = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^the\s+/, "")
    .trim();
  return key || name.trim().toLowerCase();
}
