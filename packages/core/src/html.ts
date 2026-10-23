import type { RemoteType, Salary } from "./jobs";
import { parseRemoteType } from "./location";
import { parseAmount, parsePeriod, sanitizeSalary } from "./salary";
import { cleanText, decodeEntities, htmlToText } from "./text";

/** The fields of a schema.org `JobPosting` the adapters read. */
export interface JobPostingData {
  title: string | null;
  orgName: string | null;
  orgWebsite: string | null;
  description: string | null;
  location: string | null;
  remoteType: RemoteType | null;
  salary: Salary | null;
  postedAt: Date | null;
  expiresAt: Date | null;
  applyUrl: string | null;
}

const PLACEHOLDER_ORG_NAMES = new Set(["jobs", "careers", "career", "hiring", "recruiting", "apply", "job board"]);

/** All JSON-LD objects on a page, flattening arrays and `@graph`. */
export function readJsonLd(html: string): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = [];
  const pattern =
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    let parsed: unknown;
    try {
      // Some sites leave raw newlines inside JSON strings, which JSON.parse rejects.
      parsed = JSON.parse(match[1]!.replace(/[\u0000-\u001f]+/g, " "));
    } catch {
      continue;
    }
    const queue = [parsed];
    while (queue.length > 0) {
      const item = queue.shift();
      if (Array.isArray(item)) {
        queue.push(...item);
      } else if (isRecord(item)) {
        objects.push(item);
        if (Array.isArray(item["@graph"])) {
          queue.push(...item["@graph"]);
        }
      }
    }
  }
  return objects;
}

/** Reads the first schema.org `JobPosting` on a page, or null when there is none. */
export function readJobPosting(html: string): JobPostingData | null {
  const posting = readJsonLd(html).find((item) => {
    const type = item["@type"];
    return type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
  });
  if (!posting) {
    return null;
  }
  const org = isRecord(posting.hiringOrganization) ? posting.hiringOrganization : null;
  // JSON-LD strings are plain text, but some boards leave HTML entities in them.
  const orgName = textOf(org?.name);
  const location = jobLocationText(posting.jobLocation);
  const telecommute = posting.jobLocationType === "TELECOMMUTE";
  const applicantCountry = placeName(posting.applicantLocationRequirements);
  return {
    title: textOf(posting.title),
    // Some ATS accounts are named after the board, not the employer ("jobs" on Lever).
    orgName: orgName && !PLACEHOLDER_ORG_NAMES.has(orgName.toLowerCase()) ? orgName : null,
    orgWebsite: asString(org?.sameAs) ?? asString(org?.url),
    description: asString(posting.description)
      ? htmlToText(asString(posting.description)!)
      : null,
    location:
      location ?? (telecommute ? `Remote${applicantCountry ? ` (${applicantCountry})` : ""}` : null),
    remoteType: telecommute ? "remote" : parseRemoteType(location),
    salary: readBaseSalary(posting.baseSalary),
    postedAt: parseDate(asString(posting.datePosted)),
    expiresAt: parseDate(asString(posting.validThrough)),
    applyUrl: asString(posting.url),
  };
}

function readBaseSalary(value: unknown): Salary | null {
  if (!isRecord(value)) {
    return null;
  }
  const amount = isRecord(value.value) ? value.value : value;
  const single = parseAmount(asNumberish(amount.value));
  return sanitizeSalary({
    min: parseAmount(asNumberish(amount.minValue)) ?? single,
    max: parseAmount(asNumberish(amount.maxValue)),
    currency: asString(value.currency)?.toUpperCase() ?? null,
    period: parsePeriod(asString(amount.unitText)) ?? "year",
  });
}

function jobLocationText(value: unknown): string | null {
  const places = Array.isArray(value) ? value : value ? [value] : [];
  const names = places.map(placeName).filter((name): name is string => !!name);
  return names.length > 0 ? [...new Set(names)].join("; ") : null;
}

function placeName(value: unknown): string | null {
  if (typeof value === "string") {
    return cleanText(value);
  }
  if (!isRecord(value)) {
    return null;
  }
  const address = value.address ?? value;
  if (typeof address === "string") {
    return cleanText(address);
  }
  if (!isRecord(address)) {
    return cleanText(asString(value.name));
  }
  const parts = [address.addressLocality, address.addressRegion, address.addressCountry]
    .map((part) => (isRecord(part) ? asString(part.name) : asString(part)))
    .map(cleanText)
    .filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(", ") : cleanText(asString(value.name));
}

/**
 * Shrinks a page for storage: drops scripts (except JSON-LD), styles, inline
 * SVG, comments, and inline style attributes, and collapses whitespace.
 */
export function compactPageCopy(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, (whole, attrs: string) =>
      /application\/ld\+json/i.test(attrs) ? whole : "",
    )
    .replace(/<(style|svg|noscript|template)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/\s(style|class|data-[\w-]+)="[^"]*"/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parses an ISO date or date-time; a bare date is read as midnight UTC. */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? `${value.trim()}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function textOf(value: unknown): string | null {
  const text = asString(value);
  return text ? cleanText(decodeEntities(text)) : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumberish(value: unknown): string | number | null {
  return typeof value === "number" || typeof value === "string" ? value : null;
}
