import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_JUDGE_PROVIDER_ID, parseEvalEnvironment, resolveEvalDefaults } from "./provider";

const JUDGE_KEY_ENV_BY_PROVIDER_PREFIX = {
  google: "GOOGLE_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
} as const;

function judgeCredentialEnvName(providerId: string): string {
  const prefix = providerId.split(":", 1)[0] as keyof typeof JUDGE_KEY_ENV_BY_PROVIDER_PREFIX;
  const envName = JUDGE_KEY_ENV_BY_PROVIDER_PREFIX[prefix];
  if (!envName) {
    throw new Error(
      `Unsupported key-based judge provider "${providerId}". Add its native credential variable mapping to evals/promptfoo/run.ts.`,
    );
  }
  return envName;
}

function optionalKey(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function withJudgeCredential(env: NodeJS.ProcessEnv, providerId: string, apiKey: string | undefined): NodeJS.ProcessEnv {
  if (!apiKey) return env;
  return { ...env, [judgeCredentialEnvName(providerId)]: apiKey };
}

function promptfooEnvironment(env: NodeJS.ProcessEnv, command = ""): NodeJS.ProcessEnv {
  const withDefaults = { ...env, ...resolveEvalDefaults(env) };
  if (command !== "eval") {
    return withJudgeCredential(
      withDefaults,
      withDefaults.EVAL_JUDGE_PROVIDER_ID,
      optionalKey(env.EVAL_JUDGE_API_KEY) ?? optionalKey(env.GEMINI_API_KEY),
    );
  }

  const resolved = parseEvalEnvironment(withDefaults);
  return withJudgeCredential({ ...withDefaults, ...resolved }, resolved.EVAL_JUDGE_PROVIDER_ID, resolved.EVAL_JUDGE_API_KEY);
}

function main(): void {
  if (existsSync(".env")) process.loadEnvFile(".env");

  const promptfooEntrypoint = fileURLToPath(
    new URL("../../node_modules/promptfoo/dist/src/entrypoint.js", import.meta.url),
  );
  const result = spawnSync(process.execPath, [promptfooEntrypoint, ...process.argv.slice(2)], {
    env: promptfooEnvironment(process.env, process.argv[2]),
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  describe("promptfooEnvironment", () => {
    it.each([
      ["google:gemini-3.1-pro-low", "GOOGLE_API_KEY"],
      ["openai:responses:gpt-5", "OPENAI_API_KEY"],
      ["anthropic:messages:claude-sonnet-4-5", "ANTHROPIC_API_KEY"],
    ])("maps %s to its provider-native credential variable", (providerId, nativeEnvName) => {
      const env = promptfooEnvironment({
        EVAL_JUDGE_PROVIDER_ID: providerId,
        EVAL_JUDGE_API_KEY: "judge-key",
      });
      expect(env[nativeEnvName]).toBe("judge-key");
    });

    it("fails clearly for an unmapped key-based provider", () => {
      expect(() =>
        promptfooEnvironment({
          EVAL_JUDGE_PROVIDER_ID: "example:model",
          EVAL_JUDGE_API_KEY: "judge-key",
        }),
      ).toThrow(/Unsupported key-based judge provider "example:model"/);
    });

    it("fills production defaults without requiring keys for validate and view", () => {
      const env = promptfooEnvironment({}, "validate");
      expect(env.EVAL_JUDGE_PROVIDER_ID).toBe(DEFAULT_JUDGE_PROVIDER_ID);
      expect(env.EVAL_TRANSLATION_MODEL).toBeTruthy();
      expect(env.GOOGLE_API_KEY).toBeUndefined();
    });

    it("maps GEMINI_API_KEY onto both roles for a live eval", () => {
      const env = promptfooEnvironment({ GEMINI_API_KEY: "ci-key" }, "eval");
      expect(env.EVAL_TRANSLATION_API_KEY).toBe("ci-key");
      expect(env.EVAL_JUDGE_API_KEY).toBe("ci-key");
      expect(env.GOOGLE_API_KEY).toBe("ci-key");
      expect(env.EVAL_JUDGE_PROVIDER_ID).toBe(DEFAULT_JUDGE_PROVIDER_ID);
    });

    it("fails a live eval when no API key is available", () => {
      expect(() => promptfooEnvironment({}, "eval")).toThrow(/GEMINI_API_KEY/);
    });
  });
}
