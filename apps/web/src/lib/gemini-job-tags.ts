import { buildTaggingRequest, readTaggingAnswer, TAGGING_MODEL, type TaggingAnswer } from "@civic-job-board/core/job-tags";
import { errorMessage } from "./error-message";

const GEMINI_API = `https://generativelanguage.googleapis.com/v1beta/models/${TAGGING_MODEL}:generateContent`;
const GEMINI_TIMEOUT_MS = 20_000;

export type GeminiJobTagsResult =
  | { outcome: "answer"; answer: TaggingAnswer }
  | { outcome: "transient-error"; error: string; status: number | null };

/**
 * Asks Gemini to tag one job. Any completed answer, even a malformed one, is read
 * into tags; a failed request (HTTP error, network, timeout, interrupted body) is
 * transient, with its HTTP status when there was one.
 */
export async function requestGeminiJobTags(
  apiKey: string, job: { title: string; employerName: string | null; description: string },
): Promise<GeminiJobTagsResult> {
  try {
    const response = await fetch(GEMINI_API, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(buildTaggingRequest(job)),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { outcome: "transient-error", error: `Gemini: HTTP ${response.status}`, status: response.status };
    }
    // Keep body-read failures outside the parse catch so interrupted responses remain retryable.
    const body = await response.text();
    let answer: unknown;
    try {
      answer = JSON.parse(body);
    } catch {
      answer = null;
    }
    return { outcome: "answer", answer: readTaggingAnswer(answer) };
  } catch (cause) {
    return { outcome: "transient-error", error: errorMessage(cause), status: null };
  }
}
