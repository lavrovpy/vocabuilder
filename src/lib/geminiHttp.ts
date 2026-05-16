import { geminiError, type GeminiErrorSurface } from "./geminiError";

/**
 * Map a Gemini API HTTP response to the right `geminiError` and throw it.
 * Returns silently on `response.ok` so the caller can read the body.
 * Shared by translate (`gemini.ts`) and TTS (`tts.ts`) — keep status-code
 * handling in one place so the two transports stay in sync.
 */
export async function throwForHttpError(response: Response, surface: GeminiErrorSurface, model: string): Promise<void> {
  if (response.status === 401 || response.status === 403) {
    throw geminiError({ domain: "infrastructure", kind: "invalid-api-key", surface });
  }
  if (response.status === 404) {
    throw geminiError({ domain: "infrastructure", kind: "model-not-found", surface, model });
  }
  if (!response.ok) {
    let body = "";
    try {
      body = (await response.text()).slice(0, 500);
    } catch {
      // body unreadable - proceed with empty
    }
    throw geminiError({
      domain: "infrastructure",
      kind: "request-failed",
      surface,
      status: response.status,
      body,
    });
  }
}
