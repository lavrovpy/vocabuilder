/**
 * Constants describing our integration with Google's Generative Language API:
 * the retry policy and the audio output contract for TTS. Shared by `gemini.ts`
 * (translation) and `tts.ts` (audio).
 *
 * The endpoint itself is user-configurable and lives in `baseUrl.ts`; its
 * default is declared as the `geminiApiBaseUrl` preference in package.json.
 */
export const MAX_RETRY_ATTEMPTS = 3;
export const BASE_RETRY_DELAY_MS = 400;

// Gemini TTS audio contract — these describe what the API returns; changing
// them does not change Gemini's output, it only breaks our WAV wrapper.
export const TTS_DEFAULT_VOICE = "Kore";
export const TTS_SAMPLE_RATE = 24000;
export const TTS_NUM_CHANNELS = 1;
export const TTS_BITS_PER_SAMPLE = 16;
