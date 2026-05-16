/**
 * Transport-level constants for talking to Google's Generative Language API.
 * Kept here so `gemini.ts` (translation) and `tts.ts` (audio) share one
 * endpoint and one retry policy.
 */
export const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export const MAX_RETRY_ATTEMPTS = 3;
export const BASE_RETRY_DELAY_MS = 400;
