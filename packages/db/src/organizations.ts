import { employerDomain, orgNameKey, parseAtsLink } from "@civic-job-board/core";
import { arrayContains, eq } from "drizzle-orm";
import { organizations } from "./schema";
import type { Db } from "./source-runs";

/** The alias keys an employer is matched by; see `organizations.aliases`. */
export function organizationAliases(input: {
  orgName: string | null;
  applyUrl: string | null;
}): { nameKey: string | null; atsKey: string | null } {
  const ats = parseAtsLink(input.applyUrl);
  return {
    nameKey: input.orgName ? `name:${orgNameKey(input.orgName)}` : null,
    atsKey: ats?.orgSlug ? `ats:${ats.provider}:${ats.orgSlug.toLowerCase()}` : null,
  };
}

/**
 * Finds the employer a job belongs to and creates it when it is new and
 * named. A named job is matched by its name only. An unnamed job (as on the
 * Civic Tech Field Guide's feed) is matched by its employer's account on the
 * ATS its apply link points at, when exactly one known employer has that
 * account; many government agencies share one ATS account, so an account
 * never overrides a name. Learns the employer's ATS account and domain as
 * sources reveal them. Returns null when nothing identifies an employer.
 */
export async function resolveOrganization(
  db: Db,
  input: { orgName: string | null; orgWebsite?: string | null; applyUrl: string | null },
): Promise<number | null> {
  const { nameKey, atsKey } = organizationAliases(input);
  const domain = employerDomain(input.orgWebsite);
  if (nameKey === null) {
    if (atsKey === null) {
      return null;
    }
    const matches = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(arrayContains(organizations.aliases, [atsKey]))
      .limit(2);
    return matches.length === 1 ? matches[0]!.id : null;
  }

  const [match] = await db
    .select()
    .from(organizations)
    .where(arrayContains(organizations.aliases, [nameKey]))
    .orderBy(organizations.id)
    .limit(1);
  if (match) {
    const learnsAts = atsKey !== null && !match.aliases.includes(atsKey);
    if (learnsAts || (domain && !match.domain)) {
      await db
        .update(organizations)
        .set({
          aliases: learnsAts ? [...match.aliases, atsKey] : match.aliases,
          ...(domain && !match.domain ? { domain } : {}),
        })
        .where(eq(organizations.id, match.id));
    }
    return match.id;
  }
  const [created] = await db
    .insert(organizations)
    .values({
      name: input.orgName!.trim(),
      domain,
      aliases: atsKey ? [nameKey, atsKey] : [nameKey],
    })
    .returning({ id: organizations.id });
  return created!.id;
}
