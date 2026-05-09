import { translateWord } from "../../src/lib/gemini";
import type { LanguagePair } from "../../src/lib/languages";
import type { GeminiWordResponse } from "../../src/lib/types";

type ProviderOptions = {
  id?: string;
  config?: {
    temperature?: number;
  };
};

type PromptfooContext = {
  vars?: Record<string, unknown>;
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

function requireStringVar(vars: Record<string, unknown> | undefined, key: string): string {
  const value = stringVar(vars, key);
  if (!value) {
    throw new Error(
      `Missing required eval var "${key}" — every test case in promptfooconfig.yaml must declare its language pair.`,
    );
  }
  return value;
}

function languagePairFromVars(vars: Record<string, unknown> | undefined): LanguagePair {
  return {
    source: {
      code: requireStringVar(vars, "sourceLanguageCode"),
      name: requireStringVar(vars, "sourceLanguageName"),
    },
    target: {
      code: requireStringVar(vars, "targetLanguageCode"),
      name: requireStringVar(vars, "targetLanguageName"),
    },
  };
}

function projectSuccess(
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
    senses: response.senses,
  };
}

function projectKnownError(input: string, pair: LanguagePair, error: string): Record<string, unknown> {
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
