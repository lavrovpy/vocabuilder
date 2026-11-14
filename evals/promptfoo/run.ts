import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import VocabuilderTranslateWordProvider, {
  candidateCredentialEnvName,
  DEFAULT_JUDGE_PROVIDER_ID,
  parseEvalEnvironment,
  resolveEvalDefaults,
} from "./provider";
import { writeEvaluationReport } from "./report";

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

function withJudgeCredential(
  env: NodeJS.ProcessEnv,
  providerId: string,
  apiKey: string | undefined,
): NodeJS.ProcessEnv {
  if (!apiKey) return env;
  const nativeEnvName = judgeCredentialEnvName(providerId);
  // Candidates share the judge's process. Preserve absent keys too, so a missing
  // candidate key cannot silently fall back to the judge's credentials.
  return {
    ...env,
    [candidateCredentialEnvName(nativeEnvName)]: env[nativeEnvName] ?? "",
    [nativeEnvName]: apiKey,
  };
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
  return withJudgeCredential(
    { ...withDefaults, ...resolved },
    resolved.EVAL_JUDGE_PROVIDER_ID,
    resolved.EVAL_JUDGE_API_KEY,
  );
}

function summaryOptions(args: string[]): { args: string[]; report?: { input: string; output: string } } {
  const summaryIndex = args.indexOf("--summary");
  if (summaryIndex === -1) return { args };

  const outputIndex = args.findIndex((arg) => arg === "-o" || arg === "--output");
  const input = outputIndex === -1 ? undefined : args[outputIndex + 1];
  const output = args[summaryIndex + 1];
  if (args[0] !== "eval" || !input?.endsWith(".json") || !output?.endsWith(".md")) {
    throw new Error("--summary requires an eval command with -o <results.json> and --summary <summary.md>.");
  }
  return { args: args.toSpliced(summaryIndex, 2), report: { input, output } };
}

async function runPromptfoo(args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const options = summaryOptions(args);
  if (options.report) {
    mkdirSync(path.dirname(options.report.input), { recursive: true });
    rmSync(options.report.input, { force: true });
    rmSync(options.report.output, { force: true });
  }
  const childEnv = promptfooEnvironment(env, options.args[0]);

  const promptfooEntrypoint = fileURLToPath(
    new URL("../../node_modules/promptfoo/dist/src/entrypoint.js", import.meta.url),
  );
  const result = spawnSync(process.execPath, [promptfooEntrypoint, ...options.args], {
    env: childEnv,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  const status = result.status ?? 1;
  if (options.report && existsSync(options.report.input)) {
    try {
      await writeEvaluationReport(options.report.input, options.report.output);
    } catch {
      process.stderr.write("Evaluation summary could not be generated.\n");
      return status || 1;
    }
  } else if (options.report && status === 0) {
    process.stderr.write("Evaluation did not produce the JSON results needed for its summary.\n");
    return 1;
  }
  return status;
}

async function main(): Promise<void> {
  if (existsSync(".env")) process.loadEnvFile(".env");
  process.exitCode = await runPromptfoo(process.argv.slice(2), process.env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

if (import.meta.vitest) {
  const { afterEach, describe, expect, it, vi } = import.meta.vitest;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

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

    it.each([
      ["openai", "openai:responses:gpt-5", "OPENAI_API_KEY", "Authorization", "Bearer candidate-key"],
      ["anthropic", "anthropic:messages:claude-sonnet-4-5", "ANTHROPIC_API_KEY", "x-api-key", "candidate-key"],
    ])("keeps %s candidate requests separate from the judge key", async (provider, judge, nativeEnv, header, key) => {
      const env = promptfooEnvironment(
        {
          GEMINI_API_KEY: "gemini-key",
          [nativeEnv]: "candidate-key",
          EVAL_JUDGE_PROVIDER_ID: judge,
          EVAL_JUDGE_API_KEY: "judge-key",
        },
        "eval",
      );
      const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 401 }));
      vi.stubGlobal("fetch", fetchMock);
      vi.spyOn(console, "error").mockImplementation(() => {});

      const candidate = new VocabuilderTranslateWordProvider({ config: { provider }, env });
      await candidate.callApi("hello", {
        vars: {
          input: "hello",
          sourceLanguageCode: "en",
          sourceLanguageName: "English",
          targetLanguageCode: "uk",
          targetLanguageName: "Ukrainian",
        },
      } as unknown as Parameters<typeof candidate.callApi>[1]);

      expect(env[nativeEnv]).toBe("judge-key");
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get(header)).toBe(key);
    });

    it.each([
      ["openai", "openai:responses:gpt-5", "OPENAI_API_KEY"],
      ["anthropic", "anthropic:messages:claude-sonnet-4-5", "ANTHROPIC_API_KEY"],
    ])("does not lend the judge key to an unconfigured %s candidate", async (provider, judge, nativeEnv) => {
      const env = promptfooEnvironment(
        { GEMINI_API_KEY: "gemini-key", EVAL_JUDGE_PROVIDER_ID: judge, EVAL_JUDGE_API_KEY: "judge-key" },
        "eval",
      );
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const candidate = new VocabuilderTranslateWordProvider({ config: { provider }, env });
      await expect(
        candidate.callApi("hello", {
          vars: {
            sourceLanguageCode: "en",
            sourceLanguageName: "English",
            targetLanguageCode: "uk",
            targetLanguageName: "Ukrainian",
          },
        } as unknown as Parameters<typeof candidate.callApi>[1]),
      ).rejects.toThrow(nativeEnv);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("evaluation summaries", () => {
    it("rejects summary arguments without a JSON evaluation output", () => {
      expect(() => summaryOptions(["validate", "--summary", "summary.md"])).toThrow(/requires an eval command/);
      expect(() => summaryOptions(["eval", "--summary", "summary.md"])).toThrow(/results.json/);
    });

    it.each([true, false])(
      "writes a summary for a completed evaluation (passes: %s)",
      async (passes) => {
        const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
        const { tmpdir } = await import("node:os");
        const directory = await mkdtemp(path.join(tmpdir(), "vocabuilder-eval-"));
        try {
          const config = path.join(directory, "config.json");
          const output = path.join(directory, "results.json");
          const summary = path.join(directory, "summary.md");
          await writeFile(
            config,
            JSON.stringify({
              prompts: ["{{input}}"],
              providers: ["echo"],
              tests: [
                {
                  vars: { input: "hello" },
                  metadata: { pair: "en->uk", category: "common", tier: "smoke", difficulty: "easy" },
                  assert: [{ type: "equals", value: passes ? "hello" : "different" }],
                },
              ],
            }),
          );
          const status = await runPromptfoo(
            [
              "eval",
              "-c",
              config,
              "-o",
              output,
              "--summary",
              summary,
              "--no-write",
              "--no-cache",
              "--no-progress-bar",
              "--no-table",
              "--no-share",
            ],
            {
              PATH: process.env.PATH,
              GEMINI_API_KEY: "test-key",
              EVAL_JUDGE_API_KEY: "judge-key-not-exported",
              PROMPTFOO_CONFIG_DIR: directory,
              PROMPTFOO_LOG_DIR: path.join(directory, "logs"),
              PROMPTFOO_PASS_RATE_THRESHOLD: "75",
              PROMPTFOO_DISABLE_TELEMETRY: "true",
              PROMPTFOO_DISABLE_UPDATE: "true",
            },
          );
          expect(status).toBe(passes ? 0 : 100);
          const rawResults = await readFile(output, "utf8");
          expect(JSON.parse(rawResults)).toHaveProperty("results");
          expect(rawResults).not.toContain("test-key");
          expect(rawResults).not.toContain("judge-key-not-exported");
          expect(await readFile(summary, "utf8")).toContain(
            `Overall: **${passes ? "1/1 passed (100.0%)" : "0/1 passed (0.0%)"}**`,
          );
          expect(await readFile(summary, "utf8")).toContain("| en->uk |");
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      },
      20000,
    );

    it("removes stale results and summaries when evaluation cannot start", async () => {
      const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const directory = await mkdtemp(path.join(tmpdir(), "vocabuilder-eval-"));
      try {
        const output = path.join(directory, "results.json");
        const summary = path.join(directory, "summary.md");
        await writeFile(output, JSON.stringify({ results: [] }));
        await writeFile(summary, "Previous run");
        const status = await runPromptfoo(
          ["eval", "-c", path.join(directory, "missing.json"), "-o", output, "--summary", summary],
          {
            PATH: process.env.PATH,
            GEMINI_API_KEY: "test-key",
            PROMPTFOO_CONFIG_DIR: directory,
            PROMPTFOO_LOG_DIR: path.join(directory, "logs"),
            PROMPTFOO_DISABLE_TELEMETRY: "true",
            PROMPTFOO_DISABLE_UPDATE: "true",
          },
        );
        expect(status).not.toBe(0);
        expect(existsSync(output)).toBe(false);
        expect(existsSync(summary)).toBe(false);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }, 20000);

    it("clears previous artifacts before rejecting missing credentials", async () => {
      const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const directory = await mkdtemp(path.join(tmpdir(), "vocabuilder-eval-"));
      try {
        const output = path.join(directory, "results.json");
        const summary = path.join(directory, "summary.md");
        await writeFile(output, JSON.stringify({ results: [] }));
        await writeFile(summary, "Previous run");
        await expect(runPromptfoo(["eval", "-o", output, "--summary", summary], {})).rejects.toThrow(/GEMINI_API_KEY/);
        expect(existsSync(output)).toBe(false);
        expect(existsSync(summary)).toBe(false);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  });
}
