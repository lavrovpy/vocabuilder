import { z } from "zod";
import type {
  ApiProvider,
  CallApiContextParams,
  ProviderOptions,
  ProviderResponse,
} from "promptfoo";
import { translateWord } from "../../src/lib/gemini";
import { isGeminiError, isOutcome } from "../../src/lib/geminiError";
import type { LanguagePair } from "../../src/lib/languages";
import { getPreferenceDefault } from "../../src/lib/manifest";
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

export const DEFAULT_JUDGE_PROVIDER_ID = "google:gemini-3-flash-preview";

export const EvalEnvironmentSchema = z.object({
  EVAL_TRANSLATION_API_KEY: z.string().min(1),
  EVAL_TRANSLATION_API_BASE_URL: z.string().url(),
  EVAL_TRANSLATION_MODEL: z.string().min(1),
  EVAL_JUDGE_API_KEY: z.string().min(1),
  EVAL_JUDGE_API_BASE_URL: z.string().url(),
  EVAL_JUDGE_PROVIDER_ID: z.string().regex(/^[^\s:]+(?::[^\s:]+)+$/),
});

export type EvalEnvironment = z.infer<typeof EvalEnvironmentSchema>;

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

/** Non-secret defaults so YAML interpolation and `eval:validate` work without live keys. */
export function resolveEvalDefaults(env: NodeJS.ProcessEnv) {
  return {
    EVAL_TRANSLATION_API_BASE_URL:
      firstNonEmpty(env.EVAL_TRANSLATION_API_BASE_URL) ?? getPreferenceDefault("geminiApiBaseUrl"),
    EVAL_TRANSLATION_MODEL: firstNonEmpty(env.EVAL_TRANSLATION_MODEL) ?? getPreferenceDefault("translationModel"),
    EVAL_JUDGE_API_BASE_URL:
      firstNonEmpty(env.EVAL_JUDGE_API_BASE_URL) ?? getPreferenceDefault("geminiApiBaseUrl"),
    EVAL_JUDGE_PROVIDER_ID: firstNonEmpty(env.EVAL_JUDGE_PROVIDER_ID) ?? DEFAULT_JUDGE_PROVIDER_ID,
  };
}

export function parseEvalEnvironment(env: NodeJS.ProcessEnv): EvalEnvironment {
  return parseOrThrow(
    EvalEnvironmentSchema,
    {
      ...resolveEvalDefaults(env),
      EVAL_TRANSLATION_API_KEY: firstNonEmpty(env.EVAL_TRANSLATION_API_KEY, env.GEMINI_API_KEY),
      EVAL_JUDGE_API_KEY: firstNonEmpty(env.EVAL_JUDGE_API_KEY, env.GEMINI_API_KEY),
    },
    "Invalid eval environment",
    "set GEMINI_API_KEY, or the EVAL_TRANSLATION_* and EVAL_JUDGE_* variables listed in .env.example.",
  );
}

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
 * Project outcome-domain Gemini errors into app-level eval JSON; return null for
 * infrastructure errors so the caller surfaces them as provider failures.
 * See AGENTS.md → Error Handling (Eval provider mapping) for the invalid-response
 * classification and how to add a future infrastructure→outcome promotion.
 */
export function projectKnownErrorOrNull(
  err: unknown,
  input: string,
  pair: LanguagePair,
): Record<string, unknown> | null {
  if (!isOutcome(err)) return null;
  return projectKnownError(input, pair, err.cause.kind);
}

export function describeFailure(err: unknown): string {
  if (!isGeminiError(err)) {
    return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }
  const cause = err.cause;
  const parts: string[] = [cause.kind];
  if (cause.domain === "infrastructure") {
    if (cause.status !== undefined) parts.push(`HTTP ${cause.status}`);
    if (cause.rateLimit?.retryDelay) parts.push(`retryDelay ${cause.rateLimit.retryDelay}`);
    const detail = cause.rateLimit?.message ?? cause.body;
    if (detail) parts.push(detail);
  }
  return parts.join(" — ");
}

export default class VocabuilderTranslateWordProvider implements ApiProvider {
  private temperature: number;
  private rawEnv: NodeJS.ProcessEnv;

  constructor(options: ProviderOptions = {}) {
    const config = parseOrThrow(
      ProviderConfigSchema,
      options.config ?? {},
      "Invalid provider config",
      "promptfooconfig.yaml must set provider config.temperature.",
    );
    this.temperature = config.temperature;
    this.rawEnv = { ...process.env, ...options.env };
  }

  id(): string {
    return `vocabuilder-production:${resolveEvalDefaults(this.rawEnv).EVAL_TRANSLATION_MODEL}`;
  }

  async callApi(prompt: string, context?: CallApiContextParams): Promise<ProviderResponse> {
    const environment = parseEvalEnvironment(this.rawEnv);
    const { pair, input: inputVar } = parseOrThrow(
      EvalVarsSchema,
      context?.vars ?? {},
      "Invalid eval vars",
      "every test case in promptfooconfig.yaml must declare its language pair.",
    );
    const input = inputVar ?? prompt.trim();

    try {
      const response = await translateWord(input, environment.EVAL_TRANSLATION_API_KEY, pair, undefined, {
        model: environment.EVAL_TRANSLATION_MODEL,
        baseUrl: environment.EVAL_TRANSLATION_API_BASE_URL,
        temperature: this.temperature,
      });
      return { output: JSON.stringify(projectSuccess(input, pair, response), null, 2) };
    } catch (err) {
      const projected = projectKnownErrorOrNull(err, input, pair);
      if (projected) return { output: JSON.stringify(projected, null, 2) };
      const reason = describeFailure(err);
      console.error(`[vocabuilder-eval] "${input}" (${pair.source.code}→${pair.target.code}) failed: ${reason}`);
      return { error: reason };
    }
  }
}
