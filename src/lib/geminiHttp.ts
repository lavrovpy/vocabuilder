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

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  const makeResponse = (status: number, body = ""): Response =>
    new Response(body, { status, statusText: `status-${status}` });

  describe("throwForHttpError", () => {
    it("returns silently on 2xx", async () => {
      await expect(throwForHttpError(makeResponse(200), "translate", "m")).resolves.toBeUndefined();
    });

    it.each([401, 403])("maps %d to invalid-api-key with the caller's surface", async (status) => {
      try {
        await throwForHttpError(makeResponse(status), "tts", "m");
        throw new Error("did not throw");
      } catch (err) {
        expect((err as Error).cause).toMatchObject({
          domain: "infrastructure",
          kind: "invalid-api-key",
          surface: "tts",
        });
      }
    });

    it("maps 404 to model-not-found and includes the model id", async () => {
      try {
        await throwForHttpError(makeResponse(404), "translate", "gemini-bogus");
        throw new Error("did not throw");
      } catch (err) {
        expect((err as Error).cause).toMatchObject({
          domain: "infrastructure",
          kind: "model-not-found",
          surface: "translate",
          model: "gemini-bogus",
        });
      }
    });

    it.each([429, 500, 503])("maps other non-ok %d to request-failed with status + body", async (status) => {
      try {
        await throwForHttpError(makeResponse(status, "server said no"), "translate", "m");
        throw new Error("did not throw");
      } catch (err) {
        expect((err as Error).cause).toMatchObject({
          domain: "infrastructure",
          kind: "request-failed",
          surface: "translate",
          status,
          body: "server said no",
        });
      }
    });

    it("truncates oversized error bodies to 500 chars", async () => {
      const big = "x".repeat(2000);
      try {
        await throwForHttpError(makeResponse(500, big), "tts", "m");
        throw new Error("did not throw");
      } catch (err) {
        const cause = (err as Error).cause as { body: string };
        expect(cause.body).toHaveLength(500);
      }
    });
  });
}
