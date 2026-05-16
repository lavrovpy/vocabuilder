import { z } from "zod";
import type {
  ApiProvider,
  CallApiContextParams,
  ProviderOptions,
  ProviderResponse,
} from "promptfoo";
import { translateWord } from "../../src/lib/gemini";
import { getPreferenceDefault } from "../../src/lib/manifest";
import type { LanguagePair } from "../../src/lib/languages";
import type { GeminiWordResponse } from "../../src/lib/types";

const KNOWN_DOMAIN_ERRORS = new Set([
  "WORD_NOT_FOUND",
  "INVALID_WORD_INPUT",
  "GEMINI_INVALID_RESPONSE",
]);

export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown, prefix: string, hint: string): T {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
  throw new Error(`${prefix} (${fields}) — ${hint}`);
}

export const ProviderConfigSchema = z.object({
  temperature: z.number(),
});

export const EvalVarsSchema = z
  .object({
    sourceLanguageCode: z.string().trim().min(1),
    sourceLanguageName: z.string().trim().min(1),
    targetLanguageCode: z.string().trim().min(1),
    targetLanguageName: z.string().trim().min(1),
    input: z.string().trim().min(1).optional(),
  })
  .transform((v): { pair: LanguagePair; input?: string } => ({
    pair: {
      source: { code: v.sourceLanguageCode, name: v.sourceLanguageName },
      target: { code: v.targetLanguageCode, name: v.targetLanguageName },
    },
    input: v.input,
  }));

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

export default class VocabuilderTranslateWordProvider implements ApiProvider {
  private temperature: number;

  constructor(options: ProviderOptions = {}) {
    this.temperature = parseOrThrow(
      ProviderConfigSchema,
      options.config ?? {},
      "Invalid provider config",
      "promptfooconfig.yaml must set provider config.temperature.",
    ).temperature;
  }

  id(): string {
    return "vocabuilder-production";
  }

  async callApi(prompt: string, context?: CallApiContextParams): Promise<ProviderResponse> {
    const { pair, input: inputVar } = parseOrThrow(
      EvalVarsSchema,
      context?.vars ?? {},
      "Invalid eval vars",
      "every test case in promptfooconfig.yaml must declare its language pair.",
    );
    const input = inputVar ?? prompt.trim();
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return { error: "GEMINI_API_KEY is not set" };
    }

    try {
      const response = await translateWord(input, apiKey, pair, undefined, {
        model: getPreferenceDefault("translationModel"),
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
