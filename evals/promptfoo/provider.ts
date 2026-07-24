import { z } from "zod";
import type { ApiProvider, CallApiContextParams, ProviderOptions, ProviderResponse } from "promptfoo";
import { translateWord } from "../../src/lib/translation";
import { isProviderError, isOutcome } from "../../src/lib/providerError";
import { resolveProviderConfig } from "../../src/lib/providers";
import { PROVIDER_IDS, type ProviderConfig, type ProviderId } from "../../src/lib/providers/types";
import type { LanguagePair } from "../../src/lib/languages";
import type { WordResponse } from "../../src/lib/types";

export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown, prefix: string, hint: string): T {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
  throw new Error(`${prefix} (${fields}) — ${hint}`);
}

export const ProviderConfigSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  model: z.string().trim().min(1).optional(),
});

type EvalProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const DEFAULT_JUDGE_PROVIDER_ID = "google:gemini-3-flash-preview";
export const DEFAULT_GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com";
export const DEFAULT_GEMINI_TRANSLATION_MODEL = resolveProviderConfig({
  provider: "gemini",
  apiKey: "placeholder",
}).model;

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
    EVAL_TRANSLATION_API_BASE_URL: firstNonEmpty(env.EVAL_TRANSLATION_API_BASE_URL) ?? DEFAULT_GEMINI_API_BASE_URL,
    EVAL_TRANSLATION_MODEL: firstNonEmpty(env.EVAL_TRANSLATION_MODEL) ?? DEFAULT_GEMINI_TRANSLATION_MODEL,
    EVAL_JUDGE_API_BASE_URL: firstNonEmpty(env.EVAL_JUDGE_API_BASE_URL) ?? DEFAULT_GEMINI_API_BASE_URL,
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

type ProviderEnvSpec = {
  apiKey: string;
  roleApiKey?: string;
  baseUrl: string;
  roleBaseUrl?: string;
  requireBaseUrl?: boolean;
  model: string;
  roleModel?: string;
};

const PROVIDER_ENV = {
  gemini: {
    apiKey: "GEMINI_API_KEY",
    roleApiKey: "EVAL_TRANSLATION_API_KEY",
    baseUrl: "GEMINI_BASE_URL",
    roleBaseUrl: "EVAL_TRANSLATION_API_BASE_URL",
    model: "GEMINI_MODEL",
    roleModel: "EVAL_TRANSLATION_MODEL",
  },
  anthropic: {
    apiKey: "ANTHROPIC_API_KEY",
    baseUrl: "ANTHROPIC_BASE_URL",
    model: "ANTHROPIC_MODEL",
  },
  openai: {
    apiKey: "OPENAI_API_KEY",
    baseUrl: "OPENAI_BASE_URL",
    model: "OPENAI_MODEL",
  },
  "openai-compatible": {
    apiKey: "OPENAI_COMPATIBLE_API_KEY",
    baseUrl: "OPENAI_COMPATIBLE_BASE_URL",
    requireBaseUrl: true,
    model: "OPENAI_COMPATIBLE_MODEL",
  },
} as const satisfies Record<ProviderId, ProviderEnvSpec>;

const RequiredEnvValue = z.string().trim().min(1);

/**
 * Read the credentials for one provider from the environment. Called on the first
 * request rather than in the constructor because `promptfoo validate` instantiates
 * every provider, and a config check must not require every vendor's key.
 */
function resolveEvalProviderConfig(config: EvalProviderConfig, env: NodeJS.ProcessEnv): ProviderConfig {
  const names: ProviderEnvSpec = PROVIDER_ENV[config.provider];
  const required = [names.apiKey, names.requireBaseUrl ? names.baseUrl : undefined].filter(
    (name): name is string => name !== undefined,
  );
  const roleKey = names.roleApiKey ? firstNonEmpty(env[names.roleApiKey]) : undefined;
  const candidateEnv = roleKey ? { ...env, [names.apiKey]: roleKey } : env;
  const values = parseOrThrow(
    z.object(Object.fromEntries(required.map((name) => [name, RequiredEnvValue]))),
    candidateEnv,
    `Missing environment for the ${config.provider} eval provider`,
    "set it in .env, or skip this provider with --filter-providers.",
  );
  const apiBaseUrl = names.requireBaseUrl
    ? values[names.baseUrl]
    : (firstNonEmpty(env[names.baseUrl], names.roleBaseUrl ? env[names.roleBaseUrl] : undefined) ?? "");
  const translationModel =
    config.model ?? firstNonEmpty(env[names.model], names.roleModel ? env[names.roleModel] : undefined) ?? "";
  return resolveProviderConfig({
    provider: config.provider,
    apiKey: values[names.apiKey],
    apiBaseUrl,
    translationModel,
  });
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

function projectSuccess(input: string, pair: LanguagePair, response: WordResponse): Record<string, unknown> {
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
 * Project outcome-domain provider errors into app-level eval JSON; return null for
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
  if (!isProviderError(err)) {
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
  private readonly settings: EvalProviderConfig;
  private readonly optionEnv: NodeJS.ProcessEnv | undefined;
  private resolved: ProviderConfig | undefined;

  constructor(options: ProviderOptions = {}) {
    this.settings = parseOrThrow(
      ProviderConfigSchema,
      options.config ?? {},
      "Invalid provider config",
      "each vocabuilder entry in promptfooconfig.yaml must set config.provider.",
    );
    this.optionEnv = options.env as NodeJS.ProcessEnv | undefined;
  }

  id(): string {
    return `vocabuilder-${this.settings.provider}`;
  }

  async callApi(prompt: string, context?: CallApiContextParams): Promise<ProviderResponse> {
    const { pair, input: inputVar } = parseOrThrow(
      EvalVarsSchema,
      context?.vars ?? {},
      "Invalid eval vars",
      "every test case in promptfooconfig.yaml must declare its language pair.",
    );
    const input = inputVar ?? prompt.trim();
    this.resolved ??= resolveEvalProviderConfig(this.settings, { ...process.env, ...this.optionEnv });
    const config = this.resolved;

    try {
      const response = await translateWord(input, config, pair, undefined);
      return { output: JSON.stringify(projectSuccess(input, pair, response), null, 2) };
    } catch (err) {
      const projected = projectKnownErrorOrNull(err, input, pair);
      if (projected) return { output: JSON.stringify(projected, null, 2) };
      const reason = describeFailure(err);
      console.error(
        `[vocabuilder-eval:${config.provider}] "${input}" (${pair.source.code}→${pair.target.code}) failed: ${reason}`,
      );
      return { error: reason };
    }
  }
}
