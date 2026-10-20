/**
 * Trigram similarity with the same definition as Postgres `pg_trgm`
 * `similarity()`: shared trigrams over all distinct trigrams, where each
 * lowercase alphanumeric word is padded with two spaces in front and one
 * behind.
 */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const t of ta) {
    if (tb.has(t)) {
      shared++;
    }
  }
  return shared / (ta.size + tb.size - shared);
}

function trigrams(text: string): Set<string> {
  const result = new Set<string>();
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!word) {
      continue;
    }
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) {
      result.add(padded.slice(i, i + 3));
    }
  }
  return result;
}
