import {
  GeminiApiResponseSchema,
  GeminiWordResponse,
  GeminiWordResponseSchema,
  GeminiTextResponse,
  GeminiTextResponseSchema,
  WordSense,
} from "./types";
import { asJsonStringLiteral, normalizeWordInput, normalizeTextInput } from "./input";
import { LanguagePair } from "./languages";

const MODEL = "gemini-2.5-flash-lite";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

async function callGemini(prompt: string, apiKey: string, signal?: AbortSignal): Promise<string> {
  const url = `${BASE_URL}/${MODEL}:generateContent`;

  let response: Response;
  try {
    response = await fetch(url, {
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
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error("NETWORK_OFFLINE");
    }
    throw err;
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("INVALID_API_KEY");
  }

  if (!response.ok) {
    throw new Error("GEMINI_REQUEST_FAILED");
  }

  const apiData = GeminiApiResponseSchema.parse(await response.json());
  const raw = apiData.candidates[0]?.content.parts[0]?.text ?? "";

  if (!raw) {
    throw new Error("GEMINI_EMPTY_RESPONSE");
  }

  return raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

/** Check that the source-language example sentence actually uses the word or phrase being translated. */
function exampleContainsWord(exampleTranslation: string, word: string): boolean {
  const escaped = word
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/ /g, "\\s+");
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}\\-])${escaped}(?![\\p{L}\\p{N}\\-])`, "iu");
  return pattern.test(exampleTranslation);
}

/** Same translation + part of speech = same sense, regardless of example wording. */
function senseIdentityKey(s: WordSense): string {
  return [s.translation.trim().toLowerCase(), s.partOfSpeech.trim().toLowerCase()].join("\u0001");
}

function dedupeSenses(senses: WordSense[]): WordSense[] {
  const seen = new Set<string>();
  const out: WordSense[] = [];
  for (const sense of senses) {
    const key = senseIdentityKey(sense);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sense);
  }
  return out;
}

export async function translateWord(
  word: string,
  apiKey: string,
  languagePair: LanguagePair,
  signal?: AbortSignal,
): Promise<GeminiWordResponse> {
  const normalizedWord = normalizeWordInput(word);
  if (!normalizedWord) {
    throw new Error("INVALID_WORD_INPUT");
  }

  const { source, target } = languagePair;

  const prompt = `Translate the ${source.name} vocabulary item ${asJsonStringLiteral(normalizedWord)} to ${target.name}.
The vocabulary item may be a single word, a phrasal verb (e.g. "give up", "break down"), or an idiom / fixed expression (e.g. "red herring", "kick the bucket").

CRITICAL RULES:
1. If the input is a misspelling or typo of a REAL word or expression, correct it and translate the corrected form. Put the corrected form in "correctedWord". This applies to phrases too — e.g. "red hering" → "red herring", "kik the bucket" → "kick the bucket", "runing" → "running". Prefer correction over rejection whenever a plausible correction exists.
2. Only if NO plausible correction exists and the input is truly gibberish / random letters / not in any dictionary or idiom reference, respond with: { "senses": [], "notAWord": true }
3. For phrasal verbs and idioms, translate the IDIOMATIC meaning, NOT the literal word-by-word meaning. For example, "red herring" means a misleading clue (Ukrainian: "оманлива підказка"), NOT "червоний оселедець". "Kick the bucket" means to die, NOT to literally kick a bucket.
4. Use an appropriate "partOfSpeech" label: use standard labels ("noun", "verb", "adjective", "adverb", etc.) for single words, and use "phrasal verb", "idiom", or "expression" for multi-word vocabulary items as appropriate.
5. The "exampleTranslation" (${source.name} sentence) MUST contain the EXACT phrase ${asJsonStringLiteral(normalizedWord)} (or the corrected form if misspelled) as a contiguous substring. NEVER substitute it with a synonym or paraphrase. For example, if the input is "red herring", write "That clue turned out to be a red herring." — NOT "That clue turned out to be misleading."
6. The "example" (${target.name} sentence) must be a natural idiomatic translation of the exampleTranslation.

Provide up to 5 distinct meanings (senses), ordered from most common first.
Each sense MUST have a different translation or a different part of speech — do NOT repeat the same translation+partOfSpeech pair.
If there is only one meaning, return exactly one sense.
Respond ONLY with valid JSON:
{
  "senses": [
    {
      "translation": "${target.name} gloss for this sense",
      "partOfSpeech": "noun / verb / adjective / phrasal verb / idiom / expression / etc",
      "example": "${target.name} example sentence",
      "exampleTranslation": "${source.name} sentence that MUST contain ${asJsonStringLiteral(normalizedWord)} verbatim"
    }
  ],
  "correctedWord": "include ONLY if the input was misspelled; omit if correct"
}`;

  const cleaned = await callGemini(prompt, apiKey, signal);

  try {
    const parsed = GeminiWordResponseSchema.parse(JSON.parse(cleaned));

    if (parsed.notAWord) {
      throw new Error("WORD_NOT_FOUND");
    }
    if (parsed.senses.length === 0) {
      throw new Error("GEMINI_INVALID_RESPONSE");
    }

    const effectiveWord = parsed.correctedWord ?? normalizedWord;
    const validSenses = dedupeSenses(parsed.senses).filter((s) =>
      exampleContainsWord(s.exampleTranslation, effectiveWord),
    );

    if (validSenses.length === 0) {
      throw new Error("GEMINI_INVALID_RESPONSE");
    }

    return { ...parsed, senses: validSenses };
  } catch (err) {
    if (err instanceof Error && (err.message === "WORD_NOT_FOUND" || err.message === "GEMINI_INVALID_RESPONSE")) {
      throw err;
    }
    throw new Error("GEMINI_INVALID_RESPONSE");
  }
}

// --- In-source tests for private functions ---
if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("exampleContainsWord", () => {
    it("matches a standalone word in a sentence", () => {
      expect(exampleContainsWord("I saw the cat today", "cat")).toBe(true);
    });

    it("returns false when the word is absent", () => {
      expect(exampleContainsWord("I saw the dog today", "cat")).toBe(false);
    });

    it("rejects prefix false-positive (helloworld vs hello)", () => {
      expect(exampleContainsWord("This is helloworld", "hello")).toBe(false);
    });

    it("rejects suffix false-positive (worldhello vs hello)", () => {
      expect(exampleContainsWord("This is worldhello", "hello")).toBe(false);
    });

    it("matches when adjacent to punctuation", () => {
      expect(exampleContainsWord("hello, world!", "hello")).toBe(true);
      expect(exampleContainsWord("(hello) world", "hello")).toBe(true);
      expect(exampleContainsWord('She said "hello"', "hello")).toBe(true);
    });

    it("matches case-insensitively", () => {
      expect(exampleContainsWord("Hello there", "hello")).toBe(true);
      expect(exampleContainsWord("hello there", "Hello")).toBe(true);
    });

    it("matches apostrophe words", () => {
      expect(exampleContainsWord("I don't know", "don't")).toBe(true);
      expect(exampleContainsWord("I do not know", "don't")).toBe(false);
    });

    it("treats hyphen as word-joining — parts don't match individually", () => {
      expect(exampleContainsWord("This is well-known", "well")).toBe(false);
      expect(exampleContainsWord("This is well-known", "known")).toBe(false);
      expect(exampleContainsWord("This is well-known", "well-known")).toBe(true);
    });

    it("matches Cyrillic words", () => {
      expect(exampleContainsWord("Він сказав привіт другу", "привіт")).toBe(true);
      expect(exampleContainsWord("Він сказав привітання другу", "привіт")).toBe(false);
    });

    it("matches word at start and end of string", () => {
      expect(exampleContainsWord("hello world", "hello")).toBe(true);
      expect(exampleContainsWord("say hello", "hello")).toBe(true);
    });

    it("matches a multi-word idiom as a contiguous phrase", () => {
      expect(exampleContainsWord("That clue was a red herring in the plot.", "red herring")).toBe(true);
    });

    it("rejects phrase when only one token appears", () => {
      expect(exampleContainsWord("The red fish swam past the herring.", "red herring")).toBe(false);
    });

    it("rejects phrase when tokens are not contiguous", () => {
      expect(exampleContainsWord("Red and pickled herring on the plate.", "red herring")).toBe(false);
    });

    it("tolerates multiple spaces inside the example", () => {
      expect(exampleContainsWord("A classic red  herring appears here.", "red herring")).toBe(true);
      expect(exampleContainsWord("A classic red\therring appears here.", "red herring")).toBe(true);
      expect(exampleContainsWord("A classic red\nherring appears here.", "red herring")).toBe(true);
    });

    it("matches a phrasal verb inside a sentence", () => {
      expect(exampleContainsWord("Don't give up on your dreams.", "give up")).toBe(true);
    });

    it("rejects phrase when the second token is only a prefix of a longer word", () => {
      // "give up" as regex is `give\s+up`; in "give uptown" the engine matches
      // "give up" as a prefix of "uptown", and the negative lookahead must
      // reject the trailing letter to avoid a false positive.
      expect(exampleContainsWord("She decided to give uptown tours.", "give up")).toBe(false);
    });

    it("rejects phrase when the first token is only a suffix of a longer word", () => {
      // Negative lookbehind on the first token's left boundary: "forgive up"
      // contains "give up" but "give" is glued to "for".
      expect(exampleContainsWord("I cannot forgive up to this point.", "give up")).toBe(false);
    });

    it("matches multi-word Cyrillic phrase", () => {
      expect(exampleContainsWord("Легенда про синій птах досі жива.", "синій птах")).toBe(true);
      expect(exampleContainsWord("У саду сидів птах, а небо було синє.", "синій птах")).toBe(false);
    });
  });
}

export async function translateText(
  text: string,
  apiKey: string,
  languagePair: LanguagePair,
  signal?: AbortSignal,
): Promise<GeminiTextResponse> {
  const normalizedText = normalizeTextInput(text);
  if (!normalizedText) {
    throw new Error("INVALID_TEXT_INPUT");
  }

  const { source, target } = languagePair;

  const prompt = `Translate the following ${source.name} text to ${target.name}.
Respond ONLY with valid JSON:
{ "translation": "..." }

Text: ${asJsonStringLiteral(normalizedText)}`;

  const cleaned = await callGemini(prompt, apiKey, signal);

  try {
    return GeminiTextResponseSchema.parse(JSON.parse(cleaned));
  } catch {
    throw new Error("GEMINI_INVALID_RESPONSE");
  }
}
