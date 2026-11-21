import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { parseOrThrow } from "./provider";
import { extractRows, judgeOf } from "./report";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const RUNS_DIR = fileURLToPath(new URL("../results/runs", import.meta.url));
const BASELINES_DIR = fileURLToPath(new URL("../baselines", import.meta.url));

const USAGE = `Usage:
  npm run eval:history                      every recorded run, oldest first
  npm run eval:compare [-- <run> [<run>]]   a run (default: the latest) against the baseline, or against another run
  npm run eval:baseline [-- <run>]          record a run (default: the latest) as the baseline for its candidates

<run> is a directory under evals/results/runs/ or one score-<candidate>.json inside it.`;

/** Everything that decides what a run measures. Scores taken with different versions of these files are not comparable. */
const SUITE_FILES = [
  "evals/promptfooconfig.yaml",
  "evals/promptfoo/cases.cjs",
  "evals/promptfoo/assert-output.cjs",
  "evals/promptfoo/judge-prompt.txt",
  "evals/promptfoo/transform-vars.cjs",
];

// A baseline is committed together with the change it scores, so editing it is not a code change.
const CODE_PATHSPEC = ["--", ".", ":(exclude)evals/baselines"];

const SHA256 = /^[0-9a-f]{64}$/;

const TallySchema = z.object({
  passed: z.int().nonnegative(),
  failed: z.int().nonnegative(),
  errors: z.int().nonnegative(),
});

const ScoreSchema = z.object({
  schemaVersion: z.literal(1),
  recordedAt: z.iso.datetime(),
  candidate: z.string().min(1),
  judge: z.string().min(1),
  promptfooVersion: z.string().min(1),
  git: z.object({
    commit: z.string().regex(/^[0-9a-f]{40}$/),
    dirty: z.boolean(),
    diffSha256: z.string().regex(SHA256).nullable(),
  }),
  suiteSha256: z.string().regex(SHA256),
  caseSetSha256: z.string().regex(SHA256),
  repeats: z.int().positive(),
  overall: TallySchema.extend({ passRate: z.number().min(0).max(1) }),
  cases: z.record(z.string(), TallySchema),
});

type Tally = z.infer<typeof TallySchema>;
type Score = z.infer<typeof ScoreSchema>;

export interface CodeState {
  commit: string;
  dirty: boolean;
  /** `git diff` from `commit` to the working tree, new files included; empty when nothing changed. */
  diff: string;
}

interface RunContext {
  recordedAt: Date;
  code: CodeState;
  suiteSha256: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function git(args: string[], okStatuses: readonly number[] = [0]): string {
  const result = spawnSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (!okStatuses.includes(result.status ?? -1)) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

/** The working tree against `commit`, new untracked files included (a new prompt module is a change too). */
function diffFrom(commit: string): string {
  const tracked = git(["diff", "--binary", commit, ...CODE_PATHSPEC]);
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z", ...CODE_PATHSPEC])
    .split("\0")
    .filter(Boolean)
    .sort()
    // --no-index exits 1 when the files differ, which they always do here.
    .map((file) => git(["diff", "--no-index", "--binary", "--", "/dev/null", file], [0, 1]));
  return tracked + untracked.join("");
}

export function readCodeState(): CodeState {
  const commit = git(["rev-parse", "HEAD"]).trim();
  const diff = diffFrom(commit);
  return { commit, dirty: diff.length > 0, diff };
}

export function suiteSha256(): string {
  const hash = createHash("sha256");
  for (const file of SUITE_FILES) {
    hash.update(`${file}\0`).update(readFileSync(path.join(REPO_ROOT, file))).update("\0");
  }
  return hash.digest("hex");
}

export function fileSafe(value: string): string {
  return value.replace(/[^\p{L}\p{N}._+-]+/gu, "-");
}

/** `2026-11-21T15-42-07Z-a5cd494-dirty-gemini-default`: sorts by time, and names the code it measured. */
export function runDirName(recordedAt: Date, code: CodeState, slug: string): string {
  const stamp = recordedAt.toISOString().replace(/\.\d{3}Z$/, "Z").replaceAll(":", "-");
  return `${stamp}-${code.commit.slice(0, 7)}${code.dirty ? "-dirty" : ""}-${slug}`;
}

function runs(tally: Tally): number {
  return tally.passed + tally.failed + tally.errors;
}

function rate(tally: Tally): number {
  return runs(tally) === 0 ? 0 : tally.passed / runs(tally);
}

function addTally(into: Tally, from: Tally): void {
  into.passed += from.passed;
  into.failed += from.failed;
  into.errors += from.errors;
}

function promptfooVersionOf(document: unknown): string {
  const metadata = (document as { metadata?: { promptfooVersion?: unknown } } | null)?.metadata;
  return typeof metadata?.promptfooVersion === "string" ? metadata.promptfooVersion : "unknown";
}

function buildScores(document: unknown, context: RunContext): Score[] {
  const byCandidate = new Map<string, Map<string, Tally>>();
  for (const row of extractRows(document)) {
    const candidate = row.metadata.provider ?? "unknown";
    const caseId = row.metadata.caseId ?? row.description;
    const cases = byCandidate.get(candidate) ?? new Map<string, Tally>();
    byCandidate.set(candidate, cases);
    const tally = cases.get(caseId) ?? { passed: 0, failed: 0, errors: 0 };
    cases.set(caseId, tally);
    if (row.success) tally.passed += 1;
    else if (row.error) tally.errors += 1;
    else tally.failed += 1;
  }

  const judge = judgeOf(document) ?? "unknown";
  const promptfooVersion = promptfooVersionOf(document);
  return [...byCandidate].map(([candidate, cases]) => {
    const ids = [...cases.keys()].sort();
    const overall = { passed: 0, failed: 0, errors: 0 };
    cases.forEach((tally) => addTally(overall, tally));
    return {
      schemaVersion: 1,
      recordedAt: context.recordedAt.toISOString(),
      candidate,
      judge,
      promptfooVersion,
      git: {
        commit: context.code.commit,
        dirty: context.code.dirty,
        diffSha256: context.code.diff ? sha256(context.code.diff) : null,
      },
      suiteSha256: context.suiteSha256,
      caseSetSha256: sha256(ids.join("\n")),
      repeats: Math.max(...[...cases.values()].map(runs)),
      overall: { ...overall, passRate: Math.round(rate(overall) * 10000) / 10000 },
      cases: Object.fromEntries(ids.map((id) => [id, cases.get(id) as Tally])),
    };
  });
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readScore(file: string): Score {
  return parseOrThrow(
    ScoreSchema,
    JSON.parse(readFileSync(file, "utf8")),
    `${path.relative(process.cwd(), file)} is not a valid score`,
    "it was written by an older runner or edited by hand; rerun the eval",
  );
}

function baselineFile(baselinesDir: string, candidate: string): string {
  return path.join(baselinesDir, `${fileSafe(candidate)}.json`);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function points(value: number): string {
  const rounded = (value * 100).toFixed(1);
  return `${value > 0 ? "+" : ""}${rounded} pts`;
}

function describeRun(score: Score): string {
  const at = `${score.recordedAt.slice(0, 16).replace("T", " ")} UTC`;
  return `${at}, ${score.git.commit.slice(0, 7)}${score.git.dirty ? " + uncommitted changes" : ""}`;
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function compareScores(after: Score, before: Score, beforeName: string): string {
  const warnings: string[] = [];
  if (after.candidate !== before.candidate) {
    warnings.push(`The candidates differ: ${before.candidate} → ${after.candidate}.`);
  }
  if (after.judge !== before.judge) {
    warnings.push(`The judges differ (${before.judge} → ${after.judge}), so the scores are not comparable.`);
  }
  if (after.suiteSha256 !== before.suiteSha256) {
    warnings.push(
      "The eval suite changed (cases, rubric, judge prompt or checks), so part of the difference comes from the suite, not the app.",
    );
  }
  if (after.promptfooVersion !== before.promptfooVersion) {
    warnings.push(`Promptfoo changed: ${before.promptfooVersion} → ${after.promptfooVersion}.`);
  }
  if (Math.min(after.repeats, before.repeats) < 3) {
    warnings.push(
      "One side ran each case fewer than 3 times. About a third of cases flip between two identical single runs, so read case changes as noise; run with --repeat 3 or more.",
    );
  }

  const shared = Object.keys(after.cases).filter((id) => Object.hasOwn(before.cases, id));
  const sharedTotal = (score: Score) => {
    const total = { passed: 0, failed: 0, errors: 0 };
    shared.forEach((id) => addTally(total, score.cases[id]));
    return rate(total);
  };
  const beforeRate = sharedTotal(before);
  const afterRate = sharedTotal(after);
  const onlyAfter = Object.keys(after.cases).length - shared.length;
  const onlyBefore = Object.keys(before.cases).length - shared.length;

  const changes = shared
    .map((id) => ({ id, delta: rate(after.cases[id]) - rate(before.cases[id]) }))
    .filter((change) => change.delta !== 0);
  const improved = changes.filter((change) => change.delta > 0).sort((a, b) => b.delta - a.delta);
  const regressed = changes.filter((change) => change.delta < 0).sort((a, b) => a.delta - b.delta);
  const fraction = (tally: Tally) => `${tally.passed}/${runs(tally)}`;
  const table = (title: string, rows: typeof changes) =>
    rows.length === 0
      ? []
      : [
          "",
          `### ${title} (${rows.length})`,
          "",
          `| Case | ${beforeName} | This run |`,
          "| --- | ---: | ---: |",
          ...rows.map(
            ({ id }) => `| ${escapeCell(id)} | ${fraction(before.cases[id])} | ${fraction(after.cases[id])} |`,
          ),
        ];

  const lines = [
    `## ${after.candidate}: this run vs ${beforeName}`,
    "",
    `This run: ${describeRun(after)}. ${beforeName[0].toUpperCase()}${beforeName.slice(1)}: ${describeRun(before)}.`,
    "",
    `Pass rate on ${shared.length} shared cases: **${percent(beforeRate)} → ${percent(afterRate)}** (${points(afterRate - beforeRate)}), each case run ${before.repeats} → ${after.repeats} times.`,
    ...(onlyAfter + onlyBefore > 0
      ? ["", `Left out: ${onlyAfter} cases only in this run, ${onlyBefore} only in the ${beforeName}.`]
      : []),
    ...warnings.flatMap((warning) => ["", `> **Warning:** ${warning}`]),
    ...table("Improved", improved),
    ...table("Regressed", regressed),
    ...(changes.length === 0 ? ["", "No shared case changed its pass rate."] : []),
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Writes `score-<candidate>.json` for each candidate in the run and, when that
 * candidate has a baseline, `compare-<candidate>.md`, which it also prints.
 */
export function recordRun(runDir: string, document: unknown, context: RunContext, baselinesDir = BASELINES_DIR): void {
  for (const score of buildScores(document, context)) {
    const slug = fileSafe(score.candidate);
    writeJson(path.join(runDir, `score-${slug}.json`), score);
    const baseline = baselineFile(baselinesDir, score.candidate);
    if (!existsSync(baseline)) {
      process.stdout.write(`No baseline for ${score.candidate} yet; record this run with npm run eval:baseline.\n`);
      continue;
    }
    const comparison = compareScores(score, readScore(baseline), "baseline");
    writeFileSync(path.join(runDir, `compare-${slug}.md`), comparison);
    process.stdout.write(`\n${comparison}`);
  }
}

function runDirs(runsDir: string): string[] {
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(runsDir, entry.name))
    .sort();
}

function scoreFiles(runDir: string): string[] {
  return readdirSync(runDir)
    .filter((name) => /^score-.+\.json$/.test(name))
    .map((name) => path.join(runDir, name));
}

function resolveScores(target: string | undefined, runsDir: string): Score[] {
  const location = target ? path.resolve(target) : runDirs(runsDir).at(-1);
  if (!location) throw new Error(`No runs in ${path.relative(process.cwd(), runsDir)} yet; run npm run eval first.`);
  const files = statSync(location).isDirectory() ? scoreFiles(location) : [location];
  if (files.length === 0) throw new Error(`${location} has no score files; the run did not finish.`);
  return files.map(readScore);
}

function assertSameCode(score: Score, diffNow: string): void {
  const now = diffNow ? sha256(diffNow) : null;
  if (now !== score.git.diffSha256) {
    const measured = `${score.git.commit.slice(0, 7)}${score.git.dirty ? " plus its uncommitted changes" : ""}`;
    throw new Error(
      `The code differs from what this run measured (${measured}). Rerun the eval on the current code before recording it as the baseline.`,
    );
  }
}

function recordBaselines(target: string | undefined, runsDir: string, baselinesDir: string): void {
  for (const score of resolveScores(target, runsDir)) {
    if (score.overall.errors > 0) {
      throw new Error(
        `${score.candidate} had ${score.overall.errors} provider errors in this run. A baseline must score translations, not outages; rerun the eval.`,
      );
    }
    let diffNow: string;
    try {
      diffNow = diffFrom(score.git.commit);
    } catch {
      throw new Error(`Commit ${score.git.commit.slice(0, 7)}, which this run measured, is gone; rerun the eval.`);
    }
    assertSameCode(score, diffNow);
    mkdirSync(baselinesDir, { recursive: true });
    const file = baselineFile(baselinesDir, score.candidate);
    writeJson(file, score);
    process.stdout.write(
      `Recorded ${score.candidate} at ${percent(score.overall.passRate)} in ${path.relative(process.cwd(), file)}. Commit it with the change it scores.\n`,
    );
  }
}

function compareCommand(target: string | undefined, against: string | undefined, runsDir: string, baselinesDir: string) {
  const others = against ? resolveScores(against, runsDir) : undefined;
  return resolveScores(target, runsDir)
    .map((score) => {
      if (others) {
        const other = others.find((candidate) => candidate.candidate === score.candidate);
        if (!other) return `## ${score.candidate}\n\nThe other run has no score for this candidate.\n`;
        return compareScores(score, other, "other run");
      }
      const baseline = baselineFile(baselinesDir, score.candidate);
      if (!existsSync(baseline)) return `## ${score.candidate}\n\nNo baseline yet; record one with npm run eval:baseline.\n`;
      return compareScores(score, readScore(baseline), "baseline");
    })
    .join("\n");
}

function history(runsDir: string, baselinesDir: string): string {
  const scores = runDirs(runsDir).flatMap((dir) => scoreFiles(dir).map(readScore));
  if (scores.length === 0) return "No runs recorded yet; run npm run eval first.\n";
  const baselines = new Set(
    scores
      .map((score) => baselineFile(baselinesDir, score.candidate))
      .filter((file, index, files) => existsSync(file) && files.indexOf(file) === index)
      .map((file) => {
        const baseline = readScore(file);
        return `${baseline.candidate}@${baseline.recordedAt}`;
      }),
  );
  const rows = scores
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
    .map((score) =>
      [
        score.recordedAt.slice(0, 19).replace("T", " "),
        `${score.git.commit.slice(0, 7)}${score.git.dirty ? "+" : ""}`,
        score.candidate,
        score.judge,
        String(score.repeats),
        String(Object.keys(score.cases).length),
        percent(score.overall.passRate),
        score.suiteSha256.slice(0, 7),
        baselines.has(`${score.candidate}@${score.recordedAt}`) ? "yes" : "",
      ]
        .map(escapeCell)
        .join(" | "),
    );
  return [
    "| Recorded (UTC) | Commit | Candidate | Judge | Repeats | Cases | Pass rate | Suite | Baseline |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |",
    ...rows.map((row) => `| ${row} |`),
    "",
    "A + after the commit means the run had uncommitted changes; its diff is in the run's changes.patch.",
    "",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === "history") process.stdout.write(history(RUNS_DIR, BASELINES_DIR));
    else if (command === "compare") process.stdout.write(compareCommand(args[0], args[1], RUNS_DIR, BASELINES_DIR));
    else if (command === "baseline") recordBaselines(args[0], RUNS_DIR, BASELINES_DIR);
    else throw new Error(USAGE);
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.vitest) {
  const { afterEach, describe, expect, it, vi } = import.meta.vitest;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const COMMIT = "a5cd494606f205a71be9da5f704b20e12c97a704";
  const context = (diff = ""): RunContext => ({
    recordedAt: new Date("2026-11-21T15:42:07.123Z"),
    code: { commit: COMMIT, dirty: diff.length > 0, diff },
    suiteSha256: "1".repeat(64),
  });
  const row = (candidate: string, caseId: string, outcome: "pass" | "fail" | "error") => ({
    success: outcome === "pass",
    provider: { id: "file://provider.ts", label: candidate },
    metadata: { caseId },
    ...(outcome === "error" ? { response: { error: "HTTP 402" } } : { response: { output: "{}" } }),
  });
  const documentOf = (rows: unknown[], judge = "google:gemini-3-flash-preview") => ({
    config: { defaultTest: { options: { provider: { id: judge } } } },
    metadata: { promptfooVersion: "0.125.1" },
    results: { results: rows },
  });
  const scoreOf = (cases: Record<string, [number, number]>, overrides: Partial<Score> = {}): Score => {
    const rows = Object.entries(cases).flatMap(([id, [passed, total]]) =>
      Array.from({ length: total }, (_, index) => row("gemini/default", id, index < passed ? "pass" : "fail")),
    );
    return { ...buildScores(documentOf(rows), context())[0], ...overrides };
  };
  const withTempDir = (run: (directory: string) => void) => {
    const directory = mkdtempSync(path.join(tmpdir(), "vocabuilder-score-"));
    try {
      run(directory);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };

  describe("buildScores", () => {
    it("scores each candidate separately, counting every repeat of a case", () => {
      const scores = buildScores(
        documentOf([
          row("gemini/default", "en->uk:ratchet", "pass"),
          row("gemini/default", "en->uk:ratchet", "fail"),
          row("gemini/default", "en->uk:ratchet", "pass"),
          row("gemini/default", "de->en:Schadenfreude", "error"),
          row("openai/default", "en->uk:ratchet", "pass"),
        ]),
        context("diff --git a/src/lib/translation.ts"),
      );

      expect(scores.map((score) => score.candidate)).toEqual(["gemini/default", "openai/default"]);
      const [gemini] = scores;
      expect(gemini.cases).toEqual({
        "de->en:Schadenfreude": { passed: 0, failed: 0, errors: 1 },
        "en->uk:ratchet": { passed: 2, failed: 1, errors: 0 },
      });
      expect(gemini.repeats).toBe(3);
      expect(gemini.overall).toEqual({ passed: 2, failed: 1, errors: 1, passRate: 0.5 });
      expect(gemini.judge).toBe("google:gemini-3-flash-preview");
      expect(gemini.promptfooVersion).toBe("0.125.1");
      expect(gemini.git).toMatchObject({ commit: COMMIT, dirty: true, diffSha256: expect.stringMatching(SHA256) });
    });

    it("fingerprints the case set by case IDs, independent of row order", () => {
      const rows = [row("gemini/default", "a", "pass"), row("gemini/default", "b", "fail")];
      const forward = buildScores(documentOf(rows), context())[0];
      const reversed = buildScores(documentOf([...rows].reverse()), context())[0];
      const fewer = buildScores(documentOf(rows.slice(0, 1)), context())[0];
      expect(reversed.caseSetSha256).toBe(forward.caseSetSha256);
      expect(fewer.caseSetSha256).not.toBe(forward.caseSetSha256);
      expect(forward.git.diffSha256).toBeNull();
    });
  });

  describe("runDirName", () => {
    it("starts with a sortable UTC time and names the commit, marking uncommitted changes", () => {
      const at = new Date("2026-11-21T15:42:07.123Z");
      expect(runDirName(at, { commit: COMMIT, dirty: true, diff: "x" }, "gemini-default")).toBe(
        "2026-11-21T15-42-07Z-a5cd494-dirty-gemini-default",
      );
      expect(runDirName(at, { commit: COMMIT, dirty: false, diff: "" }, "gemini-default")).toBe(
        "2026-11-21T15-42-07Z-a5cd494-gemini-default",
      );
    });
  });

  describe("recordRun", () => {
    it("writes a score that reads back through the schema, and a comparison once a baseline exists", () => {
      withTempDir((directory) => {
        vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        const baselines = path.join(directory, "baselines");
        const document = documentOf([row("openrouter/google/gemini-3.5", "en->uk:barrage", "pass")]);

        recordRun(directory, document, context(), baselines);
        const scoreFile = path.join(directory, "score-openrouter-google-gemini-3.5.json");
        expect(readScore(scoreFile).cases).toEqual({ "en->uk:barrage": { passed: 1, failed: 0, errors: 0 } });
        expect(existsSync(path.join(directory, "compare-openrouter-google-gemini-3.5.md"))).toBe(false);

        mkdirSync(baselines);
        writeFileSync(baselineFile(baselines, "openrouter/google/gemini-3.5"), readFileSync(scoreFile));
        recordRun(directory, document, context(), baselines);
        expect(readFileSync(path.join(directory, "compare-openrouter-google-gemini-3.5.md"), "utf8")).toContain(
          "**100.0% → 100.0%**",
        );
      });
    });

    it("rejects a score file the schema does not accept", () => {
      withTempDir((directory) => {
        const file = path.join(directory, "score-x.json");
        writeJson(file, { ...scoreOf({ a: [1, 1] }), schemaVersion: 0 });
        expect(() => readScore(file)).toThrow(/is not a valid score \(schemaVersion\)/);
      });
    });
  });

  describe("compareScores", () => {
    it("compares shared cases only and lists improved and regressed cases, largest change first", () => {
      const before = scoreOf({ a: [0, 3], b: [1, 3], c: [3, 3], gone: [3, 3] });
      const after = scoreOf({ a: [3, 3], b: [2, 3], c: [1, 3], added: [0, 3] });
      const report = compareScores(after, before, "baseline");

      expect(report).toContain("Pass rate on 3 shared cases: **44.4% → 66.7%** (+22.2 pts)");
      expect(report).toContain("Left out: 1 cases only in this run, 1 only in the baseline.");
      expect(report).toMatch(/### Improved \(2\)[\s\S]*\| a \| 0\/3 \| 3\/3 \|\n\| b \| 1\/3 \| 2\/3 \|/);
      expect(report).toContain("### Regressed (1)");
      expect(report).not.toContain("Warning");
    });

    it("warns when the judge, the suite or too few repeats make the comparison unreliable", () => {
      const before = scoreOf({ a: [1, 1] });
      const after = scoreOf({ a: [1, 1] }, { judge: "vertex:gemini-3.1-pro", suiteSha256: "2".repeat(64) });
      const report = compareScores(after, before, "baseline");

      expect(report).toContain("The judges differ");
      expect(report).toContain("The eval suite changed");
      expect(report).toContain("--repeat 3");
      expect(report).toContain("No shared case changed its pass rate.");
    });
  });

  describe("assertSameCode", () => {
    it("accepts the code a run measured and rejects anything else", () => {
      const clean = scoreOf({ a: [1, 1] });
      expect(() => assertSameCode(clean, "")).not.toThrow();
      expect(() => assertSameCode(clean, "diff --git a/x b/x")).toThrow(/a5cd494\)/);

      const dirty = { ...clean, git: { ...clean.git, dirty: true, diffSha256: sha256("diff A") } };
      expect(() => assertSameCode(dirty, "diff A")).not.toThrow();
      expect(() => assertSameCode(dirty, "diff B")).toThrow(/plus its uncommitted changes/);
    });
  });

  describe("history", () => {
    it("lists runs oldest first and marks the one recorded as the baseline", () => {
      withTempDir((directory) => {
        const runsDir = path.join(directory, "runs");
        const baselines = path.join(directory, "baselines");
        const first = scoreOf({ a: [0, 1] });
        const second = { ...scoreOf({ a: [1, 1] }), recordedAt: "2026-11-22T09:00:00.000Z" };
        for (const [name, score] of [
          ["2026-11-22T09-00-00Z-a5cd494-gemini-default", second],
          ["2026-11-21T15-42-07Z-a5cd494-gemini-default", first],
        ] as const) {
          mkdirSync(path.join(runsDir, name), { recursive: true });
          writeJson(path.join(runsDir, name, "score-gemini-default.json"), score);
        }
        mkdirSync(baselines);
        writeJson(baselineFile(baselines, "gemini/default"), second);

        const lines = history(runsDir, baselines).split("\n");
        expect(lines[2]).toMatch(/^\| 2026-11-21 15:42:07 \| a5cd494 \| .* \| 0\.0% \| .* \|  \|$/);
        expect(lines[3]).toMatch(/^\| 2026-11-22 09:00:00 \| .* \| 100\.0% \| .* \| yes \|$/);
      });
    });
  });

  describe("readCodeState", () => {
    it("reads the commit this checkout is on", () => {
      expect(readCodeState().commit).toMatch(/^[0-9a-f]{40}$/);
    });
  });
}
