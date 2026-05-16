/**
 * Centralized error shape for Gemini API failures (translate + TTS).
 *
 * Design: a plain `Error` whose `cause` carries a tagged object discriminated by
 * `domain`. No class, no inheritance. Narrowed by `isGeminiError`. The `message`
 * mirrors `kind` so `.toThrow("model-not-found")` works in tests.
 *
 * Two domains:
 *  - "infrastructure": API/network/transport failures the user cannot directly
 *    fix from the prompt (network down, bad key, model retired, 5xx, malformed
 *    response). These drive retries, fallbacks, and "open preferences" actions.
 *  - "outcome": the translation pipeline produced a definite, recognizable
 *    result that isn't success — input failed validation, or the model
 *    confidently said "this isn't a word." These are deterministic verdicts
 *    the eval suite asserts against; never retried, never fall back.
 */

export type GeminiInfrastructureKind =
  | "network-offline"
  | "invalid-api-key"
  | "model-not-found"
  | "request-failed"
  | "invalid-response"
  | "empty-response";

export type GeminiOutcomeKind = "word-not-found" | "invalid-word-input" | "invalid-text-input";

export type GeminiErrorKind = GeminiInfrastructureKind | GeminiOutcomeKind;

export type GeminiErrorSurface = "translate" | "tts";

export type GeminiInfrastructureCause = {
  domain: "infrastructure";
  kind: GeminiInfrastructureKind;
  surface: GeminiErrorSurface;
  model?: string;
  status?: number;
  body?: string;
};

export type GeminiOutcomeCause = {
  domain: "outcome";
  kind: GeminiOutcomeKind;
  // Outcomes are translate-only today (input validation + notAWord). Locking
  // the literal here means the type system rejects accidental TTS outcome causes;
  // widen to GeminiErrorSurface if TTS ever gains an outcome kind.
  surface: "translate";
};

export type GeminiErrorCause = GeminiInfrastructureCause | GeminiOutcomeCause;

export type GeminiError = Error & { cause: GeminiErrorCause };

export function geminiError(cause: GeminiErrorCause): GeminiError {
  return new Error(cause.kind, { cause }) as GeminiError;
}

export function isGeminiError(e: unknown): e is GeminiError {
  if (!(e instanceof Error)) return false;
  const c = e.cause;
  if (typeof c !== "object" || c === null) return false;
  return "kind" in c && "surface" in c && "domain" in c;
}

export function isOutcome(err: unknown): err is GeminiError & { cause: GeminiOutcomeCause } {
  return isGeminiError(err) && err.cause.domain === "outcome";
}

/** A failure that may succeed on retry: transport-level (offline) or 5xx/429/408. Outcomes are never transient. */
export function isTransient(err: GeminiError): boolean {
  if (err.cause.domain !== "infrastructure") return false;
  if (err.cause.kind === "network-offline") return true;
  if (err.cause.kind !== "request-failed") return false;
  const status = err.cause.status;
  return typeof status === "number" && (status >= 500 || status === 429 || status === 408);
}

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("geminiError + isGeminiError", () => {
    it("builds an Error whose message mirrors kind and whose cause carries the tag", () => {
      const e = geminiError({ kind: "model-not-found", surface: "tts", domain: "infrastructure", model: "x" });
      expect(e).toBeInstanceOf(Error);
      expect(e.message).toBe("model-not-found");
      expect(e.cause).toEqual({ kind: "model-not-found", surface: "tts", domain: "infrastructure", model: "x" });
    });

    it("isGeminiError narrows a tagged Error", () => {
      const e = geminiError({ kind: "network-offline", surface: "translate", domain: "infrastructure" });
      expect(isGeminiError(e)).toBe(true);
    });

    it("isGeminiError rejects plain Errors (no cause)", () => {
      expect(isGeminiError(new Error("WORD_NOT_FOUND"))).toBe(false);
    });

    it("isGeminiError rejects Errors whose cause lacks the tag", () => {
      expect(isGeminiError(new Error("x", { cause: { status: 500 } }))).toBe(false);
    });

    it("isGeminiError rejects causes missing the domain discriminator", () => {
      // A cause shape from before the domain refactor — must not be recognized as
      // a current GeminiError, otherwise downstream switches on domain go wrong.
      expect(isGeminiError(new Error("x", { cause: { kind: "network-offline", surface: "translate" } }))).toBe(false);
    });

    it("isGeminiError rejects non-Error values", () => {
      expect(isGeminiError("network-offline")).toBe(false);
      expect(isGeminiError(null)).toBe(false);
      expect(isGeminiError({ kind: "network-offline", surface: "tts", domain: "infrastructure" })).toBe(false);
    });
  });

  describe("isOutcome", () => {
    it("matches outcome-domain Gemini errors", () => {
      expect(isOutcome(geminiError({ kind: "word-not-found", surface: "translate", domain: "outcome" }))).toBe(true);
      expect(isOutcome(geminiError({ kind: "invalid-word-input", surface: "translate", domain: "outcome" }))).toBe(
        true,
      );
      expect(isOutcome(geminiError({ kind: "invalid-text-input", surface: "translate", domain: "outcome" }))).toBe(
        true,
      );
    });

    it("rejects infrastructure-domain Gemini errors", () => {
      expect(isOutcome(geminiError({ kind: "network-offline", surface: "translate", domain: "infrastructure" }))).toBe(
        false,
      );
      expect(isOutcome(geminiError({ kind: "request-failed", surface: "tts", domain: "infrastructure" }))).toBe(false);
    });

    it("rejects non-Gemini errors", () => {
      expect(isOutcome(new Error("anything"))).toBe(false);
    });
  });

  describe("isTransient", () => {
    const infra = (cause: GeminiInfrastructureCause): GeminiError => geminiError(cause);
    const outcome = (kind: GeminiOutcomeKind): GeminiError =>
      geminiError({ kind, surface: "translate", domain: "outcome" });

    it("network-offline is transient", () => {
      expect(isTransient(infra({ kind: "network-offline", surface: "translate", domain: "infrastructure" }))).toBe(
        true,
      );
    });

    it("5xx request-failed is transient", () => {
      expect(
        isTransient(infra({ kind: "request-failed", surface: "tts", domain: "infrastructure", status: 503 })),
      ).toBe(true);
    });

    it("429 and 408 are transient", () => {
      expect(
        isTransient(infra({ kind: "request-failed", surface: "translate", domain: "infrastructure", status: 429 })),
      ).toBe(true);
      expect(
        isTransient(infra({ kind: "request-failed", surface: "translate", domain: "infrastructure", status: 408 })),
      ).toBe(true);
    });

    it("4xx (other than 429/408) is NOT transient", () => {
      expect(
        isTransient(infra({ kind: "request-failed", surface: "translate", domain: "infrastructure", status: 400 })),
      ).toBe(false);
      expect(
        isTransient(infra({ kind: "request-failed", surface: "translate", domain: "infrastructure", status: 404 })),
      ).toBe(false);
    });

    it("invalid-api-key, model-not-found, empty/invalid-response are NOT transient", () => {
      expect(isTransient(infra({ kind: "invalid-api-key", surface: "tts", domain: "infrastructure" }))).toBe(false);
      expect(
        isTransient(infra({ kind: "model-not-found", surface: "tts", domain: "infrastructure", model: "x" })),
      ).toBe(false);
      expect(isTransient(infra({ kind: "empty-response", surface: "translate", domain: "infrastructure" }))).toBe(
        false,
      );
      expect(isTransient(infra({ kind: "invalid-response", surface: "tts", domain: "infrastructure" }))).toBe(false);
    });

    it("outcome-domain errors are NEVER transient — deterministic verdicts, not retryable", () => {
      expect(isTransient(outcome("word-not-found"))).toBe(false);
      expect(isTransient(outcome("invalid-word-input"))).toBe(false);
      expect(isTransient(outcome("invalid-text-input"))).toBe(false);
    });
  });
}
