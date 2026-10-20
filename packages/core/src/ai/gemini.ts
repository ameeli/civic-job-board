import type { FetchLike } from "../http";
import { isRecord } from "../html";
import {
  JOB_FUNCTIONS,
  SECTORS,
  SENIORITIES,
  type JobFunction,
  type Sector,
  type Seniority,
} from "./taxonomy";

/**
 * The model the daily check uses. Checked on 2026-10-20 against Google's
 * docs: Gemini 3.5 Flash-Lite is a stable model, free of charge on the free
 * tier, and the one Google recommends for high-volume simple data processing
 * (https://ai.google.dev/gemini-api/docs/models,
 * https://ai.google.dev/gemini-api/docs/pricing).
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
// Enough of a description to classify a job; keeps each request small.
const DESCRIPTION_CHARS = 1_500;

/** Only public job-posting fields; nothing about the owner is ever sent. */
export interface JobForTagging {
  id: string;
  title: string;
  orgName: string | null;
  location: string | null;
  description: string | null;
  boardTags: string[];
}

export interface JobTagging {
  id: string;
  jobFunction: { tag: JobFunction; confidence: number };
  sectors: { tag: Sector; confidence: number }[];
  seniority: Seniority;
  summary: string;
  /** The employer's name when the job's text states it, for jobs whose source did not. */
  organization: string | null;
}

export interface JobTagger {
  /** Tags a small batch of jobs in one request. Jobs the model skipped or mangled are left out. */
  tagJobs(jobs: JobForTagging[]): Promise<JobTagging[]>;
}

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    /** Set for 429s: the free tier's per-minute or per-day limit was reached. */
    readonly rateLimited = false,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

const SYSTEM_INSTRUCTION = `You classify job postings for a civic-tech job board.
For each job, return:
- job_function: the one function that best describes the role.
- sectors: one to three sectors where the work has impact, most relevant first. Use "Not impact" for ordinary commercial work with no public-interest mission.
- seniority: the role's level.
- summary: one plain sentence of at most 25 words saying what the person would do and for whom. No marketing language.
- organization: the hiring organization's name when the posting states it, otherwise an empty string.
Give each confidence as a number from 0 to 1. Return every job, using its id.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    jobs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          job_function: { type: "string", enum: JOB_FUNCTIONS },
          job_function_confidence: { type: "number" },
          sectors: {
            type: "array",
            items: {
              type: "object",
              properties: {
                sector: { type: "string", enum: SECTORS },
                confidence: { type: "number" },
              },
              required: ["sector", "confidence"],
            },
          },
          seniority: { type: "string", enum: SENIORITIES },
          summary: { type: "string" },
          organization: { type: "string" },
        },
        required: [
          "id", "job_function", "job_function_confidence", "sectors",
          "seniority", "summary", "organization",
        ],
      },
    },
  },
  required: ["jobs"],
};

export function createGeminiTagger(options: {
  apiKey: string;
  fetch: FetchLike;
  model?: string;
  timeoutMs?: number;
}): JobTagger {
  const { apiKey, fetch, model = DEFAULT_GEMINI_MODEL, timeoutMs = 60_000 } = options;
  return {
    async tagJobs(jobs) {
      if (jobs.length === 0) {
        return [];
      }
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          model,
          system_instruction: SYSTEM_INSTRUCTION,
          input: buildPrompt(jobs),
          response_format: { type: "text", mime_type: "application/json", schema: RESPONSE_SCHEMA },
          // Nothing is kept on Google's side for later turns.
          store: false,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await response.text();
      if (!response.ok) {
        throw new GeminiError(
          `Gemini returned HTTP ${response.status}: ${body.slice(0, 300)}`,
          response.status,
          response.status === 429,
        );
      }
      return parseTaggings(outputText(body), new Set(jobs.map((job) => job.id)));
    },
  };
}

export function buildPrompt(jobs: JobForTagging[]): string {
  const payload = jobs.map((job) => ({
    id: job.id,
    title: job.title,
    organization: job.orgName,
    location: job.location,
    board_categories: job.boardTags,
    description: job.description?.slice(0, DESCRIPTION_CHARS) ?? null,
  }));
  return `Classify these ${jobs.length} job postings:\n${JSON.stringify(payload, null, 2)}`;
}

// The text of the interaction's model output steps.
function outputText(body: string): string {
  const interaction: unknown = JSON.parse(body);
  const steps = isRecord(interaction) && Array.isArray(interaction.steps) ? interaction.steps : [];
  const texts: string[] = [];
  for (const step of steps) {
    if (isRecord(step) && step.type === "model_output" && Array.isArray(step.content)) {
      for (const part of step.content) {
        if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
          texts.push(part.text);
        }
      }
    }
  }
  if (texts.length === 0) {
    const status = isRecord(interaction) ? String(interaction.status) : "unknown";
    throw new GeminiError(`Gemini returned no text (status ${status})`, null);
  }
  return texts.join("");
}

/** Validates the model's JSON against the taxonomy, dropping anything that does not fit. */
export function parseTaggings(text: string, expectedIds: ReadonlySet<string>): JobTagging[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GeminiError("Gemini returned malformed JSON", null);
  }
  const items = isRecord(parsed) && Array.isArray(parsed.jobs) ? parsed.jobs : [];
  const taggings = new Map<string, JobTagging>();
  for (const item of items) {
    if (!isRecord(item) || typeof item.id !== "string" || !expectedIds.has(item.id)) {
      continue;
    }
    const jobFunction = oneOf(JOB_FUNCTIONS, item.job_function);
    const seniority = oneOf(SENIORITIES, item.seniority);
    const summary = typeof item.summary === "string" ? item.summary.trim() : "";
    if (!jobFunction || !seniority || !summary) {
      continue;
    }
    const sectors = new Map<Sector, number>();
    for (const entry of Array.isArray(item.sectors) ? item.sectors : []) {
      const sector = isRecord(entry) ? oneOf(SECTORS, entry.sector) : null;
      if (isRecord(entry) && sector && !sectors.has(sector)) {
        sectors.set(sector, confidence(entry.confidence));
      }
    }
    if (sectors.size === 0) {
      continue;
    }
    const organization =
      typeof item.organization === "string" && item.organization.trim() ? item.organization.trim() : null;
    taggings.set(item.id, {
      id: item.id,
      jobFunction: { tag: jobFunction, confidence: confidence(item.job_function_confidence) },
      sectors: [...sectors].slice(0, 3).map(([tag, value]) => ({ tag, confidence: value })),
      seniority,
      summary,
      organization,
    });
  }
  return [...taggings.values()];
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function confidence(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}
