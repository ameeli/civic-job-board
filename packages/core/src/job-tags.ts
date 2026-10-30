/** Gemini's cheapest free-tier Flash model: 10 requests/minute, 500/day as of 2026-10. */
export const TAGGING_MODEL = "gemini-3.1-flash-lite";
/** What fits in one 300-second daily run at one request every 6.5 seconds. */
export const MAX_JOBS_TAGGED_PER_RUN = 35;
/** Keeps requests under the free tier's 10 per minute. */
export const PAUSE_BETWEEN_TAGGING_REQUESTS_MS = 6_500;
/** source_runs.source for tagging runs, next to the job sources' own rows. */
export const TAGGING_RUN_SOURCE = "gemini-tagging";
const MAX_DESCRIPTION_CHARS = 4_000;
const MAX_TAGS = 3;

export const ROLE_TAGS = {
  "software-engineering": { label: "Software engineering", covers: "developers, software/test/automation engineers, solution and application architects" },
  "infrastructure-devops": { label: "Infrastructure & DevOps", covers: "cloud, DevOps, platform, systems engineers, cloud admins" },
  security: { label: "Security", covers: "cybersecurity, cloud security architects" },
  "data-analysis": { label: "Data analysis", covers: "data analysts, research/program-evaluation analysts, data governance" },
  "data-science-ai": { label: "Data science & AI", covers: "data scientists, data/ML engineers, AI specialists and AI leads" },
  "product-management": { label: "Product management", covers: "product managers, product owners, fellows on product teams" },
  "design-research": { label: "Design & research", covers: "UX/UI, service/civic design, user research, accessibility" },
  "project-program-management": { label: "Project & program management", covers: "technical project managers, delivery managers, program managers" },
  "business-systems-analysis": { label: "Business & systems analysis", covers: "business analysts, solution specialists, integration SMEs, systems analysts" },
  "technology-leadership": { label: "Technology leadership", covers: "CTO, CIO, CDO, directors of IT/innovation/data" },
  "policy-operations": { label: "Policy & operations", covers: "policy analysts, COO, strategy and operations roles" },
  "communications-content": { label: "Communications & content", covers: "social media, multimedia, technical writing, digital strategy" },
  unknown: { label: "Unknown", covers: "none of the above fits" },
} as const;

export const SECTOR_TAGS = {
  "health-human-services": { label: "Health & human services", covers: "public health, Medicaid/Medi-Cal, child and family services" },
  education: { label: "Education", covers: "K-12, community colleges, universities, teacher credentialing" },
  "justice-public-safety": { label: "Justice & public safety", covers: "courts, district attorneys, attorneys general, corrections, emergency services" },
  transportation: { label: "Transportation", covers: "DOTs, transit authorities, aviation, rail" },
  "housing-community": { label: "Housing & community development", covers: "housing agencies, community development" },
  "finance-revenue": { label: "Finance & revenue", covers: "tax, budget/finance, pensions/retirement systems, banking regulation" },
  "environment-energy": { label: "Environment, energy & utilities", covers: "natural resources, fish & game, power and water utilities" },
  "economic-workforce": { label: "Economic development & workforce", covers: "economic opportunity, labor, workforce programs" },
  "general-government": { label: "General government & technology", covers: "state/city IT offices, governor's and mayor's offices, digital services teams, civic-tech vendors" },
  unknown: { label: "Unknown", covers: "none of the above fits" },
} as const;

export const SENIORITY_LEVELS = {
  entry: { label: "Entry level", covers: "interns, student assistants, junior, level 1" },
  mid: { label: "Mid level", covers: "the usual individual-contributor level when not marked senior" },
  senior: { label: "Senior", covers: "senior, lead, principal, staff, team managers" },
  leadership: { label: "Leadership", covers: "director, chief, deputy chief, head, executive director" },
  unknown: { label: "Unknown", covers: "not clear from the listing" },
} as const;

export type RoleTag = keyof typeof ROLE_TAGS;
export type SectorTag = keyof typeof SECTOR_TAGS;
export type Seniority = keyof typeof SENIORITY_LEVELS;

export interface JobTags {
  roleTags: RoleTag[];
  sectorTags: SectorTag[];
  seniority: Seniority;
  summary: string | null;
}

type TagList = Record<string, { label: string; covers: string }>;

function describeList(list: TagList): string {
  return Object.entries(list).map(([slug, { label, covers }]) => `- ${slug} (${label}): ${covers}`).join("\n");
}

function tagArraySchema(list: TagList) {
  return { type: "array", minItems: 1, maxItems: MAX_TAGS, items: { type: "string", enum: Object.keys(list) } };
}

const INSTRUCTIONS = `You tag civic-tech job listings. Pick only from these lists.
Role tags (1-${MAX_TAGS}):
${describeList(ROLE_TAGS)}
Sector tags (1-${MAX_TAGS}), by the employer's or program's area of government:
${describeList(SECTOR_TAGS)}
Seniority (exactly one):
${describeList(SENIORITY_LEVELS)}
Summary: one plain English sentence of 20 words or fewer saying what the job does.`;

/** The Gemini generateContent body for one job; the response schema enumerates every allowed tag. */
export function buildTaggingRequest(job: { title: string; employerName: string | null; description: string }) {
  const listing = `Title: ${job.title}\nEmployer: ${job.employerName ?? "Unknown"}\nDescription:\n${job.description.slice(0, MAX_DESCRIPTION_CHARS)}`;
  return {
    systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
    contents: [{ role: "user", parts: [{ text: listing }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: {
        type: "object",
        properties: {
          roleTags: tagArraySchema(ROLE_TAGS),
          sectorTags: tagArraySchema(SECTOR_TAGS),
          seniority: { type: "string", enum: Object.keys(SENIORITY_LEVELS) },
          summary: { type: "string" },
        },
        required: ["roleTags", "sectorTags", "seniority", "summary"],
      },
    },
  };
}

/** Valid tags, deduplicated and capped; "unknown" only when nothing valid remains. */
function validTags<Tag extends string>(value: unknown, list: Record<Tag, unknown>) {
  const answered = Array.isArray(value) ? value.filter((tag): tag is Tag => Object.hasOwn(list, tag)) : [];
  const known = [...new Set(answered.filter(tag => tag !== "unknown"))].slice(0, MAX_TAGS);
  return {
    tags: (known.length ? known : ["unknown"]) as [Tag, ...Tag[]],
    defaulted: answered.length === 0,
  };
}

export interface TaggingAnswer {
  tags: JobTags;
  /** True when role, sector, or seniority fell back to "unknown" because the answer lacked a valid value. */
  defaultedToUnknown: boolean;
}

/**
 * Reads a completed Gemini generateContent response. It never throws: off-list tags are
 * dropped, and anything missing or unreadable (malformed, truncated, blocked, or empty)
 * becomes "unknown" (or a null summary). Persistence and retry behavior are documented
 * in README.md#job-tags.
 */
export function readTaggingAnswer(response: unknown): TaggingAnswer {
  let answer: Record<string, unknown> = {};
  try {
    const text = (response as { candidates: { content: { parts: { text: string }[] } }[] }).candidates[0]!.content.parts[0]!.text;
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") answer = parsed as Record<string, unknown>;
  } catch {
    // An unreadable answer tags the job as all unknown.
  }
  const roles = validTags(answer.roleTags, ROLE_TAGS);
  const sectors = validTags(answer.sectorTags, SECTOR_TAGS);
  const validSeniority = typeof answer.seniority === "string" && Object.hasOwn(SENIORITY_LEVELS, answer.seniority);
  const summary = typeof answer.summary === "string" && answer.summary.trim() ? answer.summary.trim() : null;
  return {
    tags: {
      roleTags: roles.tags,
      sectorTags: sectors.tags,
      seniority: validSeniority ? answer.seniority as Seniority : "unknown",
      summary,
    },
    defaultedToUnknown: roles.defaulted || sectors.defaulted || !validSeniority,
  };
}

function labels(slugs: readonly string[], list: TagList): string {
  return slugs.map(slug => list[slug]?.label ?? slug).join(", ");
}

/** One plain line of a tagged job's role, sector, and seniority labels. */
export function describeJobTags(tags: { roleTags: readonly string[]; sectorTags: readonly string[]; seniority: string }): string {
  return `Roles: ${labels(tags.roleTags, ROLE_TAGS)} · Sectors: ${labels(tags.sectorTags, SECTOR_TAGS)} · Seniority: ${labels([tags.seniority], SENIORITY_LEVELS)}`;
}
