import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

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

function promptfooEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const providerId = env.EVAL_JUDGE_PROVIDER_ID?.trim();
  const apiKey = env.EVAL_JUDGE_API_KEY?.trim();
  if (!providerId || !apiKey) return { ...env };
  return { ...env, [judgeCredentialEnvName(providerId)]: apiKey };
}

function main(): void {
  if (existsSync(".env")) process.loadEnvFile(".env");

  const promptfooEntrypoint = fileURLToPath(
    new URL("../../node_modules/promptfoo/dist/src/entrypoint.js", import.meta.url),
  );
  const result = spawnSync(process.execPath, [promptfooEntrypoint, ...process.argv.slice(2)], {
    env: promptfooEnvironment(process.env),
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

    it("leaves incomplete configuration for the shared environment validator", () => {
      expect(promptfooEnvironment({ EVAL_JUDGE_PROVIDER_ID: "google:model" })).toEqual({
        EVAL_JUDGE_PROVIDER_ID: "google:model",
      });
    });
  });
}
