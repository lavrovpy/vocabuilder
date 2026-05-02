import { translateWord } from "../../src/lib/gemini";
import type { GeminiWordResponse } from "../../src/lib/types";

type Language = {
  code: string;
  name: string;
};

type LanguagePair = {
  source: Language;
  target: Language;
};

type ProviderOptions = {
  id?: string;
  config?: {
    temperature?: number;
  };
};

type PromptfooContext = {
  vars?: Record<string, unknown>;
};

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  uk: "Ukrainian",
  ru: "Russian",
  be: "Belarusian",
  pl: "Polish",
  de: "German",
  fr: "French",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  cs: "Czech",
  sv: "Swedish",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  tr: "Turkish",
};

const KNOWN_DOMAIN_ERRORS = new Set([
  "WORD_NOT_FOUND",
  "INVALID_WORD_INPUT",
  "GEMINI_INVALID_RESPONSE",
]);

function stringVar(vars: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = vars?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function language(code: string | undefined, name: string | undefined, fallbackCode: string): Language {
  const resolvedCode = code ?? fallbackCode;
  return {
    code: resolvedCode,
    name: name ?? LANGUAGE_NAMES[resolvedCode] ?? resolvedCode,
  };
}

export function languagePairFromVars(vars: Record<string, unknown> | undefined): LanguagePair {
  return {
    source: language(
      stringVar(vars, "sourceLanguageCode"),
      stringVar(vars, "sourceLanguageName"),
      "en",
    ),
    target: language(
      stringVar(vars, "targetLanguageCode"),
      stringVar(vars, "targetLanguageName"),
      "uk",
    ),
  };
}

/**
 * FNV-1a 32-bit hash, coerced to signed int32 for Gemini generationConfig.seed.
 */
export function seedFromEvalInput(input: string, pair: LanguagePair): number {
  let h = 0x811c9dc5;
  const material = `${pair.source.code}:${pair.target.code}:${input}`;
  for (let i = 0; i < material.length; i++) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

export function projectSuccess(
  input: string,
  pair: LanguagePair,
  response: GeminiWordResponse,
): Record<string, unknown> {
  return {
    status: "ok",
    input,
    languagePair: pair,
    correctedWord: response.correctedWord ?? null,
    notAWord: response.notAWord === true,
    senses: response.senses.map((sense) => ({
      translation: sense.translation,
      partOfSpeech: sense.partOfSpeech,
      example: sense.example,
      exampleTranslation: sense.exampleTranslation,
    })),
  };
}

export function projectKnownError(input: string, pair: LanguagePair, error: string): Record<string, unknown> {
  return {
    status: "error",
    input,
    languagePair: pair,
    error,
  };
}

export default class VocabuilderTranslateWordProvider {
  private providerId: string;
  private temperature: number;

  constructor(options: ProviderOptions = {}) {
    this.providerId = options.id ?? "vocabuilder-production";
    this.temperature = options.config?.temperature ?? 0;
  }

  id(): string {
    return this.providerId;
  }

  async callApi(prompt: string, context?: PromptfooContext): Promise<{ output?: string; error?: string }> {
    const input = stringVar(context?.vars, "input") ?? prompt.trim();
    const pair = languagePairFromVars(context?.vars);
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return { error: "GEMINI_API_KEY is not set" };
    }

    try {
      const response = await translateWord(input, apiKey, pair, undefined, {
        temperature: this.temperature,
        seed: seedFromEvalInput(input, pair),
      });
      return { output: JSON.stringify(projectSuccess(input, pair, response), null, 2) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (KNOWN_DOMAIN_ERRORS.has(message)) {
        return { output: JSON.stringify(projectKnownError(input, pair, message), null, 2) };
      }
      return { error: message };
    }
  }
}
