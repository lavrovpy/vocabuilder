import { MAX_PHRASE_TOKENS, MAX_VOCAB_LENGTH } from "./input";

function modelFromCause(err: Error): string {
  const cause = err.cause as { model?: string } | undefined;
  return cause?.model ?? "the configured model";
}

export function getUserFacingErrorMessage(err: string | Error): string {
  const errorCode = err instanceof Error ? err.message : err;
  switch (errorCode) {
    case "INVALID_API_KEY":
      return "Invalid API key. Please check your Gemini API key in preferences.";
    case "GEMINI_MODEL_NOT_FOUND":
      return err instanceof Error
        ? `Translation model "${modelFromCause(err)}" was not found or is deprecated. Update "Translation Model" in extension preferences.`
        : 'Translation model "the configured model" was not found or is deprecated. Update "Translation Model" in extension preferences.';
    case "GEMINI_REQUEST_FAILED":
      return "Gemini request failed. Please try again.";
    case "GEMINI_EMPTY_RESPONSE":
    case "GEMINI_INVALID_RESPONSE":
      return "Gemini returned an unexpected response. Please try again.";
    case "NETWORK_OFFLINE":
      return "You appear to be offline. Check your connection and try again.";
    case "WORD_NOT_FOUND":
      return "This word or phrase was not recognized. Check the spelling or try something else.";
    case "INVALID_WORD_INPUT":
      return `Enter a word or short phrase (letters, apostrophe, hyphen; up to ${MAX_PHRASE_TOKENS} words, ${MAX_VOCAB_LENGTH} chars).`;
    case "INVALID_TEXT_INPUT":
      return "Text is empty or too long.";
    default:
      return "Translation failed. Please try again.";
  }
}

export function getTranslationErrorToastTitle(errorCode: string): string {
  switch (errorCode) {
    case "NETWORK_OFFLINE":
      return "No Internet Connection";
    case "GEMINI_MODEL_NOT_FOUND":
      return "Model not found";
    default:
      return "Translation failed";
  }
}
