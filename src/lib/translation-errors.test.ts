import { describe, it, expect } from "vitest";
import { MAX_PHRASE_TOKENS, MAX_VOCAB_LENGTH } from "./input";
import { getUserFacingErrorMessage } from "./translation-errors";

describe("getUserFacingErrorMessage", () => {
  it("formats literal validation error codes without requiring Error objects", () => {
    expect(getUserFacingErrorMessage("INVALID_WORD_INPUT")).toBe(
      `Enter a word or short phrase (letters, apostrophe, hyphen; up to ${MAX_PHRASE_TOKENS} words, ${MAX_VOCAB_LENGTH} chars).`,
    );
    expect(getUserFacingErrorMessage("INVALID_TEXT_INPUT")).toBe("Text is empty or too long.");
  });

  it("keeps model details from structured Error causes", () => {
    expect(getUserFacingErrorMessage(new Error("GEMINI_MODEL_NOT_FOUND", { cause: { model: "gemini-old" } }))).toBe(
      'Translation model "gemini-old" was not found or is deprecated. Update "Translation Model" in extension preferences.',
    );
  });

  it("falls back to configured model copy when only an error code is available", () => {
    expect(getUserFacingErrorMessage("GEMINI_MODEL_NOT_FOUND")).toBe(
      'Translation model "the configured model" was not found or is deprecated. Update "Translation Model" in extension preferences.',
    );
  });
});
