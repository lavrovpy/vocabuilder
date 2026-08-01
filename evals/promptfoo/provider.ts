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
import type { GeminiWordResponse } from "../../src/lib/types";

export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown, prefix: string, hint: string): T {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
  throw new Error(`${prefix} (${fields}) — ${hint}`);
}

export const ProviderConfigSchema = z.object({
  model: z.string().trim().min(1),
  temperature: z.number(),
});

export const EvalEnvironmentSchema = z.object({
  GEMINI_API_KEY: z.string().trim().min(1),
  GOOGLE_API_BASE_URL: z.string().trim().url(),
});

export function parseEvalEnvironment(env: NodeJS.ProcessEnv) {
  return parseOrThrow(
    EvalEnvironmentSchema,
    env,
    "Invalid eval environment",
    "set GEMINI_API_KEY in .env and keep env.GOOGLE_API_BASE_URL in promptfooconfig.yaml.",
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
  private model: string;
  private temperature: number;
  private environment: NodeJS.ProcessEnv;

  constructor(options: ProviderOptions = {}) {
    const config = parseOrThrow(
      ProviderConfigSchema,
      options.config ?? {},
      "Invalid provider config",
      "promptfooconfig.yaml must set provider config.model and config.temperature.",
    );
    this.model = config.model;
    this.temperature = config.temperature;
    this.environment = { ...process.env, ...options.env };
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
    let environment: z.infer<typeof EvalEnvironmentSchema>;
    try {
      environment = parseEvalEnvironment(this.environment);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }

    try {
      const response = await translateWord(input, environment.GEMINI_API_KEY, pair, undefined, {
        model: this.model,
        baseUrl: environment.GOOGLE_API_BASE_URL,
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
