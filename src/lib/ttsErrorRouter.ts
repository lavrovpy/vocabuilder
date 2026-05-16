import { defaultToastFor } from "./errorToast";
import { geminiError, isGeminiError, isTransient } from "./geminiError";
import { hasMacOsFallback } from "./tts";

export type TtsErrorRouting = { title: string; message: string; fallback: boolean };

/**
 * Route a TTS failure to a toast spec + fallback decision.
 *
 * Key invariant: when `fallback` is true, the message must NOT be a "try again"
 * prompt from defaultToastFor — the caller surfaces it in a "Using system voice"
 * success toast, where retry copy would contradict the title. All transient
 * kinds therefore swap to the neutral "Using system voice for now." copy.
 */
export function routeTtsError(err: unknown, languageCode: string): TtsErrorRouting {
  if (isGeminiError(err)) {
    const base = defaultToastFor(err.cause);
    if (isTransient(err)) {
      return { ...base, message: "Using system voice for now.", fallback: true };
    }
    return { ...base, fallback: false };
  }
  const error = err instanceof Error ? err : new Error(String(err));
  return {
    title: "Pronunciation failed",
    message: error.message || "Unknown error.",
    fallback: hasMacOsFallback(languageCode),
  };
}

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("routeTtsError — Gemini errors", () => {
    it("network-offline triggers fallback with the neutral message", () => {
      const err = geminiError({ domain: "infrastructure", kind: "network-offline", surface: "tts" });
      expect(routeTtsError(err, "en")).toMatchObject({
        message: "Using system voice for now.",
        fallback: true,
      });
    });

    // The bug this test guards against: transient HTTP errors used to surface
    // defaultToastFor's "Please try again." copy inside a success toast — wrong
    // context. All transient kinds must rewrite the message.
    it.each([408, 429, 500, 503])(
      "transient HTTP %d triggers fallback with the neutral message (no retry-prompt leakage)",
      (status) => {
        const err = geminiError({ domain: "infrastructure", kind: "request-failed", surface: "tts", status });
        const routed = routeTtsError(err, "en");
        expect(routed.fallback).toBe(true);
        expect(routed.message).toBe("Using system voice for now.");
      },
    );

    it.each([400, 404])("non-transient request-failed HTTP %d does NOT fall back", (status) => {
      const err = geminiError({ domain: "infrastructure", kind: "request-failed", surface: "tts", status });
      expect(routeTtsError(err, "en").fallback).toBe(false);
    });

    it("invalid-api-key keeps the default copy and does not fall back", () => {
      const err = geminiError({ domain: "infrastructure", kind: "invalid-api-key", surface: "tts" });
      const routed = routeTtsError(err, "en");
      expect(routed.fallback).toBe(false);
      expect(routed.message).not.toBe("Using system voice for now.");
      expect(routed.title).toBe(defaultToastFor(err.cause).title);
    });

    it("model-not-found keeps the default copy and does not fall back", () => {
      const err = geminiError({ domain: "infrastructure", kind: "model-not-found", surface: "tts", model: "x" });
      expect(routeTtsError(err, "en").fallback).toBe(false);
    });
  });

  describe("routeTtsError — unknown errors", () => {
    it("falls back when the language has a macOS voice and surfaces the error message", () => {
      expect(routeTtsError(new Error("boom"), "en")).toMatchObject({
        title: "Pronunciation failed",
        message: "boom",
        fallback: true,
      });
    });

    it("does NOT fall back when the language has no macOS voice", () => {
      expect(routeTtsError(new Error("boom"), "xx").fallback).toBe(false);
    });

    it("coerces non-Error values to a plain Error and falls back when supported", () => {
      expect(routeTtsError("string thrown", "en")).toMatchObject({
        message: "string thrown",
        fallback: true,
      });
    });

    it("substitutes 'Unknown error.' for empty error messages", () => {
      expect(routeTtsError(new Error(""), "en").message).toBe("Unknown error.");
    });
  });
}
