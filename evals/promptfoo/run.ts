import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CANDIDATE_ROUTES, type CandidateRoute, candidateCredentialEnvName, requiredCandidateEnv } from "./provider";
import { writeEvaluationReport } from "./report";

const PROVIDER_MODULE = fileURLToPath(new URL("./provider.ts", import.meta.url));
const RESULTS_DIR = fileURLToPath(new URL("../results", import.meta.url));

const USAGE = `Usage: npm run eval -- --model <route>[/<model>] [--model …] --judge <route>/<model> [promptfoo options]

  --model   the translation under test; repeat it to compare routes side by side.
            A route alone (--model anthropic) runs the app's default model.
            Routes: ${CANDIDATE_ROUTES.join(", ")}
  --judge   the llm-rubric grader. Routes: gemini, anthropic, openai, openrouter, vertex, bedrock

Example: npm run eval -- --model gemini --judge gemini/gemini-3-flash-preview`;

/** The app has no production default model for these routes. */
const MODEL_REQUIRED_ROUTES: ReadonlySet<CandidateRoute> = new Set(["openrouter", "openai-compatible"]);

type JudgeRouteSpec = {
  promptfooId: (model: string) => string;
  /** Where the judge reads its key, and where EVAL_JUDGE_API_KEY is put. */
  keyEnv?: string;
  /** Other variables Promptfoo also accepts as this judge's key. */
  fallbackKeyEnv?: readonly string[];
  requiredEnv?: readonly string[];
  stripEnv?: readonly string[];
  config?: Record<string, unknown>;
};

// Current Claude models and OpenAI reasoning models reject a non-default
// temperature, so only the Google judges get the rubric's sampling settings.
const GOOGLE_JUDGE_CONFIG = { temperature: 0, maxOutputTokens: 8192, retries: 3, timeout: 60000 };

const JUDGE_ROUTES = {
  gemini: {
    promptfooId: (model) => `google:${model}`,
    keyEnv: "GOOGLE_API_KEY",
    fallbackKeyEnv: ["GEMINI_API_KEY"],
    config: GOOGLE_JUDGE_CONFIG,
  },
  anthropic: { promptfooId: (model) => `anthropic:messages:${model}`, keyEnv: "ANTHROPIC_API_KEY" },
  openai: { promptfooId: (model) => `openai:responses:${model}`, keyEnv: "OPENAI_API_KEY" },
  openrouter: { promptfooId: (model) => `openrouter:${model}`, keyEnv: "OPENROUTER_API_KEY" },
  // Promptfoo silently switches Vertex to API-key "express mode" when either key variable is set.
  vertex: {
    promptfooId: (model) => `vertex:${model}`,
    requiredEnv: ["GOOGLE_CLOUD_PROJECT"],
    stripEnv: ["GOOGLE_API_KEY", "VERTEX_API_KEY"],
    config: GOOGLE_JUDGE_CONFIG,
  },
  // Promptfoo reads the region only from AWS_BEDROCK_REGION and otherwise falls back to us-east-1.
  bedrock: { promptfooId: (model) => `bedrock:converse:${model}`, requiredEnv: ["AWS_BEDROCK_REGION"] },
} as const satisfies Record<string, JudgeRouteSpec>;

type JudgeRoute = keyof typeof JUDGE_ROUTES;

/** Set by the runner from --model/--judge, so a caller cannot also pass them. */
const RUNNER_OWNED_FLAGS = new Set([
  "-o",
  "--output",
  "--filter-providers",
  "--filter-targets",
  "-r",
  "--providers",
  "--grader",
  "--summary",
]);

interface Candidate {
  route: CandidateRoute;
  model?: string;
}

interface EvalPlan {
  candidates: Candidate[];
  judge: { route: JudgeRoute; model: string };
  promptfooArgs: string[];
}

function usageError(message: string): Error {
  return new Error(`${message}\n\n${USAGE}`);
}

function isCandidateRoute(route: string): route is CandidateRoute {
  return (CANDIDATE_ROUTES as readonly string[]).includes(route);
}

function isJudgeRoute(route: string): route is JudgeRoute {
  return Object.hasOwn(JUDGE_ROUTES, route);
}

/** Split at the first slash only: OpenRouter IDs carry their own (`openrouter/google/gemini-…`). */
function splitRouteId(flag: string, value: string): { route: string; model?: string } {
  const slash = value.indexOf("/");
  if (slash === -1) return { route: value };
  const route = value.slice(0, slash);
  const model = value.slice(slash + 1);
  if (!route || !model) throw usageError(`${flag} "${value}" must be <route> or <route>/<model>.`);
  return { route, model };
}

function parseCandidate(value: string): Candidate {
  const { route, model } = splitRouteId("--model", value);
  if (!isCandidateRoute(route)) {
    if (isJudgeRoute(route)) {
      throw usageError(`"${route}" is a judge-only route; the app has no transport for it.`);
    }
    throw usageError(`Unknown --model route "${route}".`);
  }
  if (!model && MODEL_REQUIRED_ROUTES.has(route)) {
    throw usageError(`--model ${route} has no default model; pass ${route}/<model>.`);
  }
  return { route, model };
}

function parseJudge(value: string): EvalPlan["judge"] {
  const { route, model } = splitRouteId("--judge", value);
  if (!isJudgeRoute(route)) throw usageError(`Unknown --judge route "${route}".`);
  if (!model) throw usageError(`--judge needs a model: ${route}/<model>.`);
  return { route, model };
}

function parseEvalArgs(args: string[]): EvalPlan {
  const candidates: Candidate[] = [];
  const judges: EvalPlan["judge"][] = [];
  const promptfooArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inlineValue] = arg.startsWith("--") && arg.includes("=") ? arg.split(/=(.*)/s, 2) : [arg, undefined];
    if (flag === "--model" || flag === "--judge") {
      const value = inlineValue ?? args[(index += 1)];
      if (!value || value.startsWith("-")) throw usageError(`${flag} needs a value.`);
      if (flag === "--model") candidates.push(parseCandidate(value));
      else judges.push(parseJudge(value));
      continue;
    }
    if (RUNNER_OWNED_FLAGS.has(flag)) {
      throw usageError(`${flag} is set by the runner from --model and --judge; leave it out.`);
    }
    promptfooArgs.push(arg);
  }

  if (candidates.length === 0) throw usageError("--model is required.");
  if (judges.length !== 1) throw usageError("Pass exactly one --judge.");
  const routes = candidates.map((candidate) => candidate.route);
  const repeated = routes.find((route, index) => routes.indexOf(route) !== index);
  if (repeated) throw usageError(`--model ${repeated} is given twice; one model per route per run.`);
  return { candidates, judge: judges[0], promptfooArgs };
}

function candidateLabel(candidate: Candidate): string {
  return `${candidate.route}/${candidate.model ?? "default"}`;
}

function resultSlug(candidates: Candidate[]): string {
  return candidates
    .map((candidate) => `${candidate.route}-${candidate.model ?? "default"}`)
    .join("+")
    .replace(/[^\p{L}\p{N}._+-]+/gu, "-");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isBlank(env: NodeJS.ProcessEnv, name: string): boolean {
  return !env[name]?.trim();
}

function checkCandidateEnvironment(candidates: Candidate[], env: NodeJS.ProcessEnv): void {
  const missing = [...new Set(candidates.flatMap((candidate) => requiredCandidateEnv(candidate.route)))].filter(
    (name) => isBlank(env, name),
  );
  if (missing.length > 0) throw new Error(`Missing ${missing.join(", ")} for --model. Set it in .env.`);
}

/**
 * The child environment for the judge. A judge-specific key goes into the
 * judge's native variable, and the candidate's own value is kept under a
 * separate name, so a candidate never runs on the judge's key.
 */
function judgeEnvironment(judge: EvalPlan["judge"], env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const spec: JudgeRouteSpec = JUDGE_ROUTES[judge.route];
  const judgeKey = env.EVAL_JUDGE_API_KEY?.trim() || undefined;

  if (!spec.keyEnv) {
    for (const name of ["EVAL_JUDGE_API_KEY", "EVAL_JUDGE_API_BASE_URL"]) {
      if (!isBlank(env, name)) {
        throw new Error(`${name} does not apply to the ${judge.route} judge, which signs in with cloud credentials.`);
      }
    }
  } else if (!judgeKey && [spec.keyEnv, ...(spec.fallbackKeyEnv ?? [])].every((name) => isBlank(env, name))) {
    const names = [spec.keyEnv, ...(spec.fallbackKeyEnv ?? []), "EVAL_JUDGE_API_KEY"];
    throw new Error(`The ${judge.route} judge needs one of ${names.join(", ")}.`);
  }
  const absent = (spec.requiredEnv ?? []).filter((name) => isBlank(env, name));
  if (absent.length > 0) throw new Error(`The ${judge.route} judge needs ${absent.join(", ")}.`);

  const next: NodeJS.ProcessEnv = { ...env };
  for (const name of spec.stripEnv ?? []) delete next[name];
  if (judgeKey && spec.keyEnv) {
    next[candidateCredentialEnvName(spec.keyEnv)] = env[spec.keyEnv] ?? "";
    next[spec.keyEnv] = judgeKey;
  }
  return next;
}

function generatedConfig(plan: EvalPlan, env: NodeJS.ProcessEnv) {
  const judge: JudgeRouteSpec = JUDGE_ROUTES[plan.judge.route];
  const apiBaseUrl = env.EVAL_JUDGE_API_BASE_URL?.trim();
  return {
    // Without this key Promptfoo gives the file a default `{{prompt}}` prompt, which
    // the merge adds to the YAML's and runs every case a second time with an empty input.
    prompts: [],
    providers: plan.candidates.map((candidate) => ({
      id: `file://${PROVIDER_MODULE}`,
      label: candidateLabel(candidate),
      config: { provider: candidate.route, ...(candidate.model ? { model: candidate.model } : {}) },
    })),
    defaultTest: {
      options: {
        provider: {
          id: judge.promptfooId(plan.judge.model),
          config: { ...judge.config, ...(apiBaseUrl ? { apiBaseUrl } : {}) },
        },
      },
    },
  };
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

  const promptfooEntrypoint = fileURLToPath(
    new URL("../../node_modules/promptfoo/dist/src/entrypoint.js", import.meta.url),
  );
  const result = spawnSync(process.execPath, [promptfooEntrypoint, ...options.args], { env, stdio: "inherit" });

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

async function runEval(args: string[], env: NodeJS.ProcessEnv, resultsDir: string): Promise<number> {
  const plan = parseEvalArgs(args);
  const slug = resultSlug(plan.candidates);
  const output = path.join(resultsDir, `promptfoo-${slug}.json`);
  const summary = path.join(resultsDir, `summary-${slug}.md`);
  // Clear the previous run first, so a summary never outlives a run that failed to start.
  rmSync(output, { force: true });
  rmSync(summary, { force: true });

  checkCandidateEnvironment(plan.candidates, env);
  const childEnv = judgeEnvironment(plan.judge, env);
  const filter = `^(?:${plan.candidates.map((candidate) => escapeRegExp(candidateLabel(candidate))).join("|")})$`;

  const directory = mkdtempSync(path.join(tmpdir(), "vocabuilder-eval-"));
  try {
    const generated = path.join(directory, "run.json");
    writeFileSync(generated, JSON.stringify(generatedConfig(plan, env)));
    return await runPromptfoo(
      ["eval", ...plan.promptfooArgs, "-c", generated, "--filter-providers", filter, "-o", output, "--summary", summary],
      childEnv,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const [command, ...rest] = process.argv.slice(2);
  process.exitCode =
    command === "eval"
      ? await runEval(rest, process.env, RESULTS_DIR)
      : await runPromptfoo(process.argv.slice(2), process.env);
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

  describe("parseEvalArgs", () => {
    it("splits --model and --judge at the first slash only", () => {
      const plan = parseEvalArgs([
        "-c",
        "evals/promptfooconfig.yaml",
        "--model",
        "openrouter/google/gemini-3.5-flash-lite",
        "--judge=bedrock/us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        "--filter-sample",
        "10",
      ]);
      expect(plan.candidates).toEqual([{ route: "openrouter", model: "google/gemini-3.5-flash-lite" }]);
      expect(plan.judge).toEqual({ route: "bedrock", model: "us.anthropic.claude-sonnet-4-5-20250929-v1:0" });
      expect(plan.promptfooArgs).toEqual(["-c", "evals/promptfooconfig.yaml", "--filter-sample", "10"]);
    });

    it("reads a route alone as the app's default model and collects repeated --model flags", () => {
      const plan = parseEvalArgs(["--model", "gemini", "--model", "anthropic/claude-sonnet-5-5", "--judge", "gemini/x"]);
      expect(plan.candidates).toEqual([
        { route: "gemini", model: undefined },
        { route: "anthropic", model: "claude-sonnet-5-5" },
      ]);
    });

    it.each([
      [["--judge", "gemini/x"], /--model is required/],
      [["--model", "gemini"], /exactly one --judge/],
      [["--model", "gemini", "--judge", "gemini/x", "--judge", "gemini/y"], /exactly one --judge/],
      [["--model", "vertex/gemini-3.1-pro", "--judge", "gemini/x"], /"vertex" is a judge-only route/],
      [["--model", "mistral", "--judge", "gemini/x"], /Unknown --model route "mistral"/],
      [["--model", "openrouter", "--judge", "gemini/x"], /openrouter has no default model/],
      [["--model", "openai-compatible", "--judge", "gemini/x"], /openai-compatible has no default model/],
      [["--model", "gemini", "--judge", "gemini"], /--judge needs a model/],
      [["--model", "gemini", "--judge", "openai-compatible/llama3"], /Unknown --judge route/],
      [["--model", "gemini/", "--judge", "gemini/x"], /must be <route> or <route>\/<model>/],
      [["--model", "gemini", "--model", "gemini/other", "--judge", "gemini/x"], /given twice/],
      [["--model", "--judge", "gemini/x"], /--model needs a value/],
      [["--model", "gemini", "--judge", "gemini/x", "-o", "out.json"], /-o is set by the runner/],
      [["--model", "gemini", "--judge", "gemini/x", "--filter-providers", "x"], /--filter-providers is set by/],
      [["--model", "gemini", "--judge", "gemini/x", "--grader=google:x"], /--grader is set by the runner/],
    ])("rejects %j", (args, message) => {
      expect(() => parseEvalArgs(args)).toThrow(message);
    });

    it("prints the usage with every error", () => {
      expect(() => parseEvalArgs([])).toThrow(/Example: npm run eval -- --model gemini --judge/);
    });
  });

  describe("resultSlug", () => {
    it("names results after every candidate, with file-safe characters", () => {
      expect(
        resultSlug([
          { route: "gemini" },
          { route: "openrouter", model: "google/gemini-3.5-flash-lite" },
          { route: "openai-compatible", model: "qwen3:8b" },
        ]),
      ).toBe("gemini-default+openrouter-google-gemini-3.5-flash-lite+openai-compatible-qwen3-8b");
    });
  });

  describe("generatedConfig", () => {
    const plan = (judge: string) => parseEvalArgs(["--model", "gemini", "--model", "openai/gpt-6", "--judge", judge]);

    it.each([
      ["gemini/gemini-3.1-pro", "google:gemini-3.1-pro", GOOGLE_JUDGE_CONFIG],
      ["vertex/gemini-3.1-pro", "vertex:gemini-3.1-pro", GOOGLE_JUDGE_CONFIG],
      ["anthropic/claude-opus-5-5", "anthropic:messages:claude-opus-5-5", {}],
      ["openai/gpt-6", "openai:responses:gpt-6", {}],
      ["openrouter/anthropic/claude-sonnet-5-5", "openrouter:anthropic/claude-sonnet-5-5", {}],
      ["bedrock/us.anthropic.claude-sonnet-4-5-v1:0", "bedrock:converse:us.anthropic.claude-sonnet-4-5-v1:0", {}],
    ])("maps --judge %s to Promptfoo's %s", (judge, promptfooId, config) => {
      expect(generatedConfig(plan(judge), {}).defaultTest.options.provider).toEqual({ id: promptfooId, config });
    });

    it("adds EVAL_JUDGE_API_BASE_URL to the judge when it is set", () => {
      const config = generatedConfig(plan("openai/gpt-6"), { EVAL_JUDGE_API_BASE_URL: " http://127.0.0.1:8317 " });
      expect(config.defaultTest.options.provider.config).toEqual({ apiBaseUrl: "http://127.0.0.1:8317" });
    });

    it("adds no prompt of its own, so each case runs once per candidate", () => {
      expect(generatedConfig(plan("gemini/x"), {}).prompts).toEqual([]);
    });

    it("gives each candidate its own label and leaves the model unset for a route alone", () => {
      expect(generatedConfig(plan("gemini/x"), {}).providers).toEqual([
        { id: `file://${PROVIDER_MODULE}`, label: "gemini/default", config: { provider: "gemini" } },
        { id: `file://${PROVIDER_MODULE}`, label: "openai/gpt-6", config: { provider: "openai", model: "gpt-6" } },
      ]);
    });
  });

  describe("checkCandidateEnvironment", () => {
    it("names every missing variable before any request", () => {
      expect(() =>
        checkCandidateEnvironment(
          [{ route: "anthropic" }, { route: "openai-compatible", model: "llama3" }],
          { OPENAI_COMPATIBLE_API_KEY: "local" },
        ),
      ).toThrow("Missing ANTHROPIC_API_KEY, OPENAI_COMPATIBLE_BASE_URL for --model.");
    });
  });

  describe("judgeEnvironment", () => {
    it("accepts GEMINI_API_KEY for a gemini judge and leaves the environment as is", () => {
      const env = { GEMINI_API_KEY: "gemini-key" };
      expect(judgeEnvironment({ route: "gemini", model: "x" }, env)).toEqual(env);
    });

    it("fails when a key-based judge has no key, naming every accepted variable", () => {
      expect(() => judgeEnvironment({ route: "gemini", model: "x" }, {})).toThrow(
        "The gemini judge needs one of GOOGLE_API_KEY, GEMINI_API_KEY, EVAL_JUDGE_API_KEY.",
      );
      expect(() => judgeEnvironment({ route: "openrouter", model: "x" }, {})).toThrow(/OPENROUTER_API_KEY/);
    });

    it("requires a project for Vertex and removes the keys that would switch it to express mode", () => {
      expect(() => judgeEnvironment({ route: "vertex", model: "x" }, {})).toThrow(/GOOGLE_CLOUD_PROJECT/);
      const env = judgeEnvironment(
        { route: "vertex", model: "x" },
        { GOOGLE_CLOUD_PROJECT: "p", GOOGLE_API_KEY: "studio", VERTEX_API_KEY: "express", GEMINI_API_KEY: "g" },
      );
      expect(env).toEqual({ GOOGLE_CLOUD_PROJECT: "p", GEMINI_API_KEY: "g" });
    });

    it("requires AWS_BEDROCK_REGION for Bedrock", () => {
      expect(() => judgeEnvironment({ route: "bedrock", model: "x" }, { AWS_REGION: "eu-west-1" })).toThrow(
        /AWS_BEDROCK_REGION/,
      );
    });

    it.each(["EVAL_JUDGE_API_KEY", "EVAL_JUDGE_API_BASE_URL"])("rejects %s for a cloud-credential judge", (name) => {
      expect(() =>
        judgeEnvironment({ route: "bedrock", model: "x" }, { AWS_BEDROCK_REGION: "us-west-2", [name]: "value" }),
      ).toThrow(`${name} does not apply to the bedrock judge`);
    });

    it.each([
      ["openai", "openai/gpt-6", "OPENAI_API_KEY", "Authorization", "Bearer candidate-key"],
      ["anthropic", "anthropic/claude-opus-5-5", "ANTHROPIC_API_KEY", "x-api-key", "candidate-key"],
    ])(
      "keeps a %s candidate on its own key when the judge on the same route has EVAL_JUDGE_API_KEY",
      async (route, judge, nativeEnv, header, key) => {
        const env = judgeEnvironment(parseJudge(judge), { [nativeEnv]: "candidate-key", EVAL_JUDGE_API_KEY: "judge-key" });
        const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 401 }));
        vi.stubGlobal("fetch", fetchMock);
        vi.spyOn(console, "error").mockImplementation(() => {});

        const { default: Provider } = await import("./provider");
        const candidate = new Provider({ config: { provider: route }, env });
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
      },
    );

    it("does not lend the judge key to a candidate on the same route that has none", async () => {
      const env = judgeEnvironment(parseJudge("anthropic/claude-opus-5-5"), { EVAL_JUDGE_API_KEY: "judge-key" });
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const { default: Provider } = await import("./provider");
      const candidate = new Provider({ config: { provider: "anthropic" }, env });
      await expect(
        candidate.callApi("hello", {
          vars: {
            sourceLanguageCode: "en",
            sourceLanguageName: "English",
            targetLanguageCode: "uk",
            targetLanguageName: "Ukrainian",
          },
        } as unknown as Parameters<typeof candidate.callApi>[1]),
      ).rejects.toThrow("ANTHROPIC_API_KEY");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("runEval", () => {
    it("clears the previous results of the same candidates before rejecting missing credentials", async () => {
      const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
      const directory = await mkdtemp(path.join(tmpdir(), "vocabuilder-eval-"));
      try {
        const output = path.join(directory, "promptfoo-anthropic-default.json");
        const summary = path.join(directory, "summary-anthropic-default.md");
        await writeFile(output, JSON.stringify({ results: [] }));
        await writeFile(summary, "Previous run");
        await expect(
          runEval(["--model", "anthropic", "--judge", "gemini/x"], { GEMINI_API_KEY: "g" }, directory),
        ).rejects.toThrow(/ANTHROPIC_API_KEY/);
        expect(existsSync(output)).toBe(false);
        expect(existsSync(summary)).toBe(false);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
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
  });
}
