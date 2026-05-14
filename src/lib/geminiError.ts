/**
 * Centralized error shape for Gemini API failures (translate + TTS).
 *
 * Design: a plain `Error` whose `cause` carries a tagged `{ kind, surface, ... }`
 * object. No class, no inheritance. Narrowed by `isGeminiError`. The `message`
 * mirrors `kind` so `.toThrow("model-not-found")` works in tests.
 */

export type GeminiErrorKind =
  | "network-offline"
  | "invalid-api-key"
  | "model-not-found"
  | "request-failed"
  | "invalid-response"
  | "empty-response";

export type GeminiErrorSurface = "translate" | "tts";

export type GeminiErrorCause = {
  kind: GeminiErrorKind;
  surface: GeminiErrorSurface;
  model?: string;
  status?: number;
  body?: string;
};

export type GeminiError = Error & { cause: GeminiErrorCause };

export function geminiError(cause: GeminiErrorCause): GeminiError {
  return new Error(cause.kind, { cause }) as GeminiError;
}

export function isGeminiError(e: unknown): e is GeminiError {
  if (!(e instanceof Error)) return false;
  const c = e.cause;
  if (typeof c !== "object" || c === null) return false;
  return "kind" in c && "surface" in c;
}

/** A failure that may succeed on retry: transport-level (offline) or 5xx/429/408. */
export function isTransient(err: GeminiError): boolean {
  if (err.cause.kind === "network-offline") return true;
  if (err.cause.kind !== "request-failed") return false;
  const status = err.cause.status;
  return typeof status === "number" && (status >= 500 || status === 429 || status === 408);
}

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("geminiError + isGeminiError", () => {
    it("builds an Error whose message mirrors kind and whose cause carries the tag", () => {
      const e = geminiError({ kind: "model-not-found", surface: "tts", model: "x" });
      expect(e).toBeInstanceOf(Error);
      expect(e.message).toBe("model-not-found");
      expect(e.cause).toEqual({ kind: "model-not-found", surface: "tts", model: "x" });
    });

    it("isGeminiError narrows a tagged Error", () => {
      const e = geminiError({ kind: "network-offline", surface: "translate" });
      expect(isGeminiError(e)).toBe(true);
    });

    it("isGeminiError rejects plain Errors (no cause)", () => {
      expect(isGeminiError(new Error("WORD_NOT_FOUND"))).toBe(false);
    });

    it("isGeminiError rejects Errors whose cause lacks the tag", () => {
      expect(isGeminiError(new Error("x", { cause: { status: 500 } }))).toBe(false);
    });

    it("isGeminiError rejects non-Error values", () => {
      expect(isGeminiError("network-offline")).toBe(false);
      expect(isGeminiError(null)).toBe(false);
      expect(isGeminiError({ kind: "network-offline", surface: "tts" })).toBe(false);
    });
  });

  describe("isTransient", () => {
    const make = (cause: GeminiErrorCause): GeminiError => geminiError(cause);

    it("network-offline is transient", () => {
      expect(isTransient(make({ kind: "network-offline", surface: "translate" }))).toBe(true);
    });

    it("5xx request-failed is transient", () => {
      expect(isTransient(make({ kind: "request-failed", surface: "tts", status: 503 }))).toBe(true);
    });

    it("429 and 408 are transient", () => {
      expect(isTransient(make({ kind: "request-failed", surface: "translate", status: 429 }))).toBe(true);
      expect(isTransient(make({ kind: "request-failed", surface: "translate", status: 408 }))).toBe(true);
    });

    it("4xx (other than 429/408) is NOT transient", () => {
      expect(isTransient(make({ kind: "request-failed", surface: "translate", status: 400 }))).toBe(false);
      expect(isTransient(make({ kind: "request-failed", surface: "translate", status: 404 }))).toBe(false);
    });

    it("invalid-api-key, model-not-found, empty/invalid-response are NOT transient", () => {
      expect(isTransient(make({ kind: "invalid-api-key", surface: "tts" }))).toBe(false);
      expect(isTransient(make({ kind: "model-not-found", surface: "tts", model: "x" }))).toBe(false);
      expect(isTransient(make({ kind: "empty-response", surface: "translate" }))).toBe(false);
      expect(isTransient(make({ kind: "invalid-response", surface: "tts" }))).toBe(false);
    });
  });
}
