export type TtsErrorRouting = { title: string; message: string; fallback: boolean };

export function routeTtsError(err: unknown, canUseFallback: boolean): TtsErrorRouting {
  const error = err instanceof Error ? err : new Error(String(err));
  const cause = (error.cause ?? {}) as { model?: string; status?: number; body?: string };

  switch (error.message) {
    case "NETWORK_OFFLINE":
      return {
        title: "No internet connection",
        message: canUseFallback ? "Using system voice for now." : "Pronunciation needs internet for this language.",
        fallback: canUseFallback,
      };
    case "INVALID_API_KEY":
      return {
        title: "Invalid Gemini API key",
        message: "Update your key in extension preferences.",
        fallback: false,
      };
    case "TTS_MODEL_NOT_FOUND": {
      const model = cause.model ?? "configured model";
      return {
        title: "TTS model not found",
        message: `Model "${model}" is unavailable. Update "Text-to-Speech Model" in preferences.`,
        fallback: false,
      };
    }
    case "TTS_REQUEST_FAILED": {
      const status = cause.status;
      const is5xx = typeof status === "number" && status >= 500 && status < 600;
      return {
        title: "Pronunciation request failed",
        message: is5xx
          ? canUseFallback
            ? "Gemini service error. Using system voice for now."
            : "Gemini service error. Please try again."
          : status
            ? `Gemini returned ${status}. Check your TTS model in preferences.`
            : "Check your TTS model in preferences.",
        fallback: is5xx,
      };
    }
    case "TTS_INVALID_RESPONSE":
      return {
        title: "Unexpected response from Gemini",
        message: "The TTS model returned an unrecognized format. Try another model in preferences.",
        fallback: false,
      };
    default:
      return {
        title: "Pronunciation failed",
        message: error.message || "Unknown error.",
        fallback: true,
      };
  }
}
