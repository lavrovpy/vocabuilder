import { z } from "zod";
import type {
  ApiProvider,
  CallApiContextParams,
  ProviderOptions,
  ProviderResponse,
} from "promptfoo";
import { translateWord } from "../../src/lib/gemini";
import { isOutcome } from "../../src/lib/geminiError";
import { getPreferenceDefault } from "../../src/lib/manifest";
import type { LanguagePair } from "../../src/lib/languages";
import type { GeminiWordResponse } from "../../src/lib/types";

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

/**
 * Return a known-domain projection if this is an outcome-domain Gemini error
 * (deterministic verdict from the translation pipeline — input validation or
 * notAWord). Otherwise null — caller surfaces it as a provider-level error.
 *
 * Note: invalid-response is INFRASTRUCTURE, not outcome — the schema-level
 * failure means Gemini misbehaved, not that the input was rejected. We used to
 * project it as an app-level error (legacy GEMINI_INVALID_RESPONSE behavior),
 * but the eval YAML never asserts against it; if it ever should, add an
 * explicit infrastructure→outcome promotion here rather than widening isOutcome.
 */
export function projectKnownErrorOrNull(
  err: unknown,
  input: string,
  pair: LanguagePair,
): Record<string, unknown> | null {
  if (!isOutcome(err)) return null;
  return projectKnownError(input, pair, err.cause.kind);
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
      const projected = projectKnownErrorOrNull(err, input, pair);
      if (projected) return { output: JSON.stringify(projected, null, 2) };
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
}
