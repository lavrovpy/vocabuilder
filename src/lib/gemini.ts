import {
  GeminiApiResponseSchema,
  GeminiResponse,
  GeminiResponseSchema,
} from "./types";
import { asJsonStringLiteral, normalizeWordInput } from "./input";
import { LanguagePair } from "./languages";

const MODEL = "gemini-2.5-flash-lite";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export async function translateWord(
  word: string,
  apiKey: string,
  languagePair: LanguagePair,
  signal?: AbortSignal,
): Promise<GeminiResponse> {
  const normalizedWord = normalizeWordInput(word);
  if (!normalizedWord) {
    throw new Error("INVALID_WORD_INPUT");
  }

  const { source, target } = languagePair;

  const prompt = `Translate the ${source.name} word ${asJsonStringLiteral(normalizedWord)} to ${target.name}.
If the input is a misspelling or typo, correct it and translate the corrected word.
Respond ONLY with valid JSON:
{
  "translation": "${target.name} translation",
  "partOfSpeech": "noun/verb/adjective/etc",
  "example": "${target.name} example sentence",
  "exampleTranslation": "${source.name} translation of the example",
  "correctedWord": "include ONLY if the input was misspelled; omit if correct"
}`;

  const url = `${BASE_URL}/${MODEL}:generateContent`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
    signal,
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("INVALID_API_KEY");
  }

  if (!response.ok) {
    throw new Error("GEMINI_REQUEST_FAILED");
  }

  // Validate the outer Gemini API response shape
  const apiData = GeminiApiResponseSchema.parse(await response.json());
  const raw = apiData.candidates[0]?.content.parts[0]?.text ?? "";

  if (!raw) {
    throw new Error("GEMINI_EMPTY_RESPONSE");
  }

  // Strip markdown code fences if present
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    // Validate the translation JSON shape
    return GeminiResponseSchema.parse(JSON.parse(cleaned));
  } catch {
    throw new Error("GEMINI_INVALID_RESPONSE");
  }
}
