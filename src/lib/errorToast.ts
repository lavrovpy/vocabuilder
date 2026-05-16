import type { GeminiErrorCause } from "./geminiError";
import { MAX_PHRASE_TOKENS, MAX_VOCAB_LENGTH } from "./input";

export type ToastSpec = {
  title: string;
  message: string;
};

/**
 * Default toast copy for a Gemini error. Surface-aware where the difference is
 * deterministic copy (which preferences pane to open, "Translation" vs
 * "Pronunciation" framing). Surfaces add behavior — actions, fallbacks — on top.
 */
export function defaultToastFor(cause: GeminiErrorCause): ToastSpec {
  switch (cause.kind) {
    case "network-offline":
      return {
        title: "No internet connection",
        message: "Check your connection and try again.",
      };

    case "invalid-api-key":
      return {
        title: "Invalid Gemini API key",
        message: "Update your key in extension preferences.",
      };

    case "model-not-found": {
      const prefName = cause.surface === "tts" ? "Text-to-Speech Model" : "Translation Model";
      const verb = cause.surface === "tts" ? "TTS" : "Translation";
      const model = cause.model ?? "the configured model";
      return {
        title: `${verb} model not found`,
        message: `Model "${model}" is unavailable. Update "${prefName}" in extension preferences.`,
      };
    }

    case "request-failed": {
      const title = cause.surface === "tts" ? "Pronunciation request failed" : "Translation failed";
      const message =
        typeof cause.status === "number"
          ? `Gemini returned ${cause.status}. Please try again.`
          : "Gemini request failed. Please try again.";
      return { title, message };
    }

    case "empty-response":
      return {
        title: cause.surface === "tts" ? "No audio returned" : "Empty response from Gemini",
        message: "Try again or pick a different model in preferences.",
      };

    case "invalid-response":
      return {
        title: "Unexpected response from Gemini",
        message: "Gemini returned an unrecognized format. Try again or pick a different model.",
      };

    case "word-not-found":
      return {
        title: "Word not recognized",
        message: "This word or phrase was not recognized. Check the spelling or try something else.",
      };

    case "invalid-word-input":
      return {
        title: "Translation failed",
        message: `Enter a word or short phrase (letters, apostrophe, hyphen; up to ${MAX_PHRASE_TOKENS} words, ${MAX_VOCAB_LENGTH} chars).`,
      };

    case "invalid-text-input":
      return {
        title: "Translation failed",
        message: "Text is empty or too long.",
      };
  }
}

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("defaultToastFor", () => {
    // Tiny helper so each test reads as "infrastructure cause for kind X" without
    // 12 redundant `domain: "infrastructure"` literals diluting the intent.
    const infra = (cause: Omit<Extract<GeminiErrorCause, { domain: "infrastructure" }>, "domain">) =>
      defaultToastFor({ ...cause, domain: "infrastructure" } as GeminiErrorCause);

    it("network-offline is surface-agnostic", () => {
      const a = infra({ kind: "network-offline", surface: "translate" });
      const b = infra({ kind: "network-offline", surface: "tts" });
      expect(a).toEqual(b);
      expect(a.title).toMatch(/internet/i);
    });

    it("invalid-api-key is surface-agnostic", () => {
      const a = infra({ kind: "invalid-api-key", surface: "translate" });
      const b = infra({ kind: "invalid-api-key", surface: "tts" });
      expect(a).toEqual(b);
      expect(a.title).toMatch(/api key/i);
    });

    it("model-not-found references the correct preference name per surface", () => {
      const t = infra({ kind: "model-not-found", surface: "translate", model: "X" });
      const tts = infra({ kind: "model-not-found", surface: "tts", model: "X" });
      expect(t.message).toContain("Translation Model");
      expect(tts.message).toContain("Text-to-Speech Model");
      expect(t.message).toContain("X");
      expect(tts.message).toContain("X");
    });

    it("model-not-found falls back when model is missing", () => {
      const t = infra({ kind: "model-not-found", surface: "translate" });
      expect(t.message).toContain("the configured model");
    });

    it("request-failed title varies by surface", () => {
      const t = infra({ kind: "request-failed", surface: "translate", status: 503 });
      const tts = infra({ kind: "request-failed", surface: "tts", status: 503 });
      expect(t.title).toMatch(/translation/i);
      expect(tts.title).toMatch(/pronunciation/i);
    });

    it("request-failed surfaces the HTTP status in the message when present", () => {
      const t = infra({ kind: "request-failed", surface: "translate", status: 429 });
      expect(t.message).toContain("429");
    });

    it("request-failed omits status when not present", () => {
      const t = infra({ kind: "request-failed", surface: "translate" });
      expect(t.message).not.toMatch(/\d{3}/);
    });

    it("empty-response title varies by surface", () => {
      const t = infra({ kind: "empty-response", surface: "translate" });
      const tts = infra({ kind: "empty-response", surface: "tts" });
      expect(t.title).toMatch(/empty/i);
      expect(tts.title).toMatch(/audio/i);
    });

    it("invalid-response is surface-agnostic", () => {
      const a = defaultToastFor({ kind: "invalid-response", surface: "translate", domain: "infrastructure" });
      const b = defaultToastFor({ kind: "invalid-response", surface: "tts", domain: "infrastructure" });
      expect(a).toEqual(b);
    });

    it("word-not-found uses outcome-specific copy distinct from infrastructure errors", () => {
      const t = defaultToastFor({ kind: "word-not-found", surface: "translate", domain: "outcome" });
      expect(t.title).toMatch(/not recognized/i);
      // Don't suggest retrying — outcomes are deterministic verdicts, not transient.
      expect(t.message).not.toMatch(/try again/i);
    });

    it("invalid-word-input surfaces the input-shape constraints from src/lib/input.ts", () => {
      const t = defaultToastFor({ kind: "invalid-word-input", surface: "translate", domain: "outcome" });
      // Mention the actual numeric limits so the message stays in sync with the validator.
      expect(t.message).toMatch(/\d+\s+words/);
      expect(t.message).toMatch(/\d+\s+chars/);
    });

    it("invalid-text-input has its own copy", () => {
      const t = defaultToastFor({ kind: "invalid-text-input", surface: "translate", domain: "outcome" });
      expect(t.message).toMatch(/empty|too long/i);
    });
  });
}
