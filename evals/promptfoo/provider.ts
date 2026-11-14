import { z } from "zod";
import type { ApiProvider, CallApiContextParams, ProviderOptions, ProviderResponse } from "promptfoo";
import { translateWord, type WordLookup } from "../../src/lib/translation";
import { isProviderError, isOutcome } from "../../src/lib/providerError";
import { resolveProviderConfig } from "../../src/lib/providers";
import { PROVIDER_IDS, type ProviderConfig, type ProviderId } from "../../src/lib/providers/types";
import type { LanguagePair } from "../../src/lib/languages";

export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown, prefix: string, hint: string): T {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
  throw new Error(`${prefix} (${fields}) — ${hint}`);
}

/** `--model` routes: the app's providers, plus OpenRouter served through `openai-compatible`. */
export const CANDIDATE_ROUTES = [...PROVIDER_IDS, "openrouter"] as const;
export type CandidateRoute = (typeof CANDIDATE_ROUTES)[number];

const ProviderConfigSchema = z.object({
  provider: z.enum(CANDIDATE_ROUTES),
  model: z.string().trim().min(1).optional(),
});

type EvalProviderConfig = z.infer<typeof ProviderConfigSchema>;

type CandidateEnvSpec = {
  provider: ProviderId;
  apiKey: string;
  /** Optional override; required when `requireBaseUrl` is set. */
  baseUrl?: string;
  requireBaseUrl?: boolean;
  fixedBaseUrl?: string;
};

const CANDIDATE_ENV = {
  gemini: { provider: "gemini", apiKey: "GEMINI_API_KEY", baseUrl: "GEMINI_BASE_URL" },
  anthropic: { provider: "anthropic", apiKey: "ANTHROPIC_API_KEY", baseUrl: "ANTHROPIC_BASE_URL" },
  openai: { provider: "openai", apiKey: "OPENAI_API_KEY", baseUrl: "OPENAI_BASE_URL" },
  "openai-compatible": {
    provider: "openai-compatible",
    apiKey: "OPENAI_COMPATIBLE_API_KEY",
    baseUrl: "OPENAI_COMPATIBLE_BASE_URL",
    requireBaseUrl: true,
  },
  openrouter: { provider: "openai-compatible", apiKey: "OPENROUTER_API_KEY", fixedBaseUrl: "https://openrouter.ai/api/v1" },
} as const satisfies Record<CandidateRoute, CandidateEnvSpec>;

/** The variables a candidate route cannot run without, for the runner's pre-flight check. */
export function requiredCandidateEnv(route: CandidateRoute): string[] {
  const spec: CandidateEnvSpec = CANDIDATE_ENV[route];
  return spec.requireBaseUrl && spec.baseUrl ? [spec.apiKey, spec.baseUrl] : [spec.apiKey];
}

const RequiredEnvValue = z.string().trim().min(1);

export function candidateCredentialEnvName(nativeEnvName: string): string {
  return `VOCABUILDER_CANDIDATE_${nativeEnvName}`;
}

/**
 * Read the credentials for one candidate from the environment. Called on the first
 * request rather than in the constructor because `promptfoo validate` instantiates
 * every provider, and a config check must not require every vendor's key.
 */
function resolveEvalProviderConfig(config: EvalProviderConfig, env: NodeJS.ProcessEnv): ProviderConfig {
  const spec: CandidateEnvSpec = CANDIDATE_ENV[config.provider];
  const required = requiredCandidateEnv(config.provider);
  const candidateEnv = { ...env, [spec.apiKey]: env[candidateCredentialEnvName(spec.apiKey)] ?? env[spec.apiKey] };
  const values = parseOrThrow(
    z.object(Object.fromEntries(required.map((name) => [name, RequiredEnvValue]))),
    candidateEnv,
    `Missing environment for the ${config.provider} eval candidate`,
    "set it in .env.",
  );
  const apiBaseUrl = spec.fixedBaseUrl ?? (spec.baseUrl ? env[spec.baseUrl]?.trim() : undefined) ?? "";
  return resolveProviderConfig({
    provider: spec.provider,
    apiKey: values[spec.apiKey],
    apiBaseUrl,
    translationModel: config.model ?? "",
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

function projectSuccess(input: string, pair: LanguagePair, response: WordLookup): Record<string, unknown> {
  return {
    status: "ok",
    input,
    languagePair: response.languagePair,
    languagePairSwitched: response.languagePair.source.code !== pair.source.code,
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
      "each vocabuilder entry must set config.provider to a candidate route.",
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
