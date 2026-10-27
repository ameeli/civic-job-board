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

// Title words that name a level or seniority, mapped to one spelling.
const LEVEL_MARKERS: Record<string, string> = {
  intern: "intern", internship: "intern", entry: "entry", junior: "junior", jr: "junior",
  associate: "associate", assistant: "assistant", mid: "mid", senior: "senior", sr: "senior",
  staff: "staff", principal: "principal", lead: "lead", head: "head", chief: "chief",
  manager: "manager", director: "director", executive: "executive", deputy: "deputy",
  vp: "vp", vice: "vp",
  i: "1", ii: "2", iii: "3", iv: "4", v: "5", "1": "1", "2": "2", "3": "3", "4": "4", "5": "5",
};

/**
 * Whether two job titles name the same level: "Software Engineer" and
 * "Software Engineer II", or "Product Manager" and "Senior Product Manager",
 * are different jobs however similar the rest of the title is.
 */
export function sameLevel(a: string, b: string): boolean {
  const la = levelMarkers(a);
  const lb = levelMarkers(b);
  return la.size === lb.size && [...la].every((marker) => lb.has(marker));
}

function levelMarkers(title: string): Set<string> {
  const result = new Set<string>();
  for (const word of title.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    const marker = Object.hasOwn(LEVEL_MARKERS, word) ? LEVEL_MARKERS[word] : undefined;
    if (marker) {
      result.add(marker);
    }
  }
  return result;
}
