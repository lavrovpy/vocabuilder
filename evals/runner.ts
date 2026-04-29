import { applicableScorers, HARD_SCORER_THRESHOLD } from "./evaluators";
import { runCase, DEFAULT_LANGUAGE_PAIR } from "./executor";
import type {
  AggregateReport,
  CaseReport,
  CaseRunResult,
  DriftEntry,
  EvalCase,
  EvalDataset,
} from "./types";

export const DEFAULT_SUITE_THRESHOLD = 0.9;

export type RunnerOptions = {
  apiKey: string;
  suite: "smoke" | "full";
  threshold?: number;
  runsPerCase?: number;
  onCaseStart?: (c: EvalCase, dataset: string) => void;
  onCaseDone?: (report: CaseReport) => void;
};

function average(scores: number[]): number {
  if (scores.length === 0) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function scoreCase(
  c: EvalCase,
  runs: CaseRunResult[],
): { hard: Record<string, number>; soft: Record<string, number>; passed: boolean } {
  const scorers = applicableScorers(c.target);
  const hard: Record<string, number> = {};
  const soft: Record<string, number> = {};

  for (const scorer of scorers) {
    const perRun = runs.map((r) => scorer.score(r, c));
    const avg = average(perRun);
    if (scorer.tier === "hard") hard[scorer.name] = avg;
    else soft[scorer.name] = avg;
  }

  const passed = Object.values(hard).every((s) => s >= HARD_SCORER_THRESHOLD);
  return { hard, soft, passed };
}

export async function runEvals(
  datasets: EvalDataset[],
  options: RunnerOptions,
): Promise<AggregateReport> {
  const startedAt = new Date();
  const startMs = Date.now();
  const cases: CaseReport[] = [];

  for (const dataset of datasets) {
    for (const c of dataset.cases) {
      options.onCaseStart?.(c, dataset.name);
      const runs = await runCase(c, options.apiKey, { runs: options.runsPerCase });
      const { hard, soft, passed } = scoreCase(c, runs);
      const caseReport: CaseReport = {
        input: c.input,
        dataset: dataset.name,
        category: c.category,
        passed,
        scorerScores: { hard, soft },
        runs: runs.map((r) =>
          r.kind === "ok" ? { outputOrError: r.output } : { outputOrError: { error: r.message } },
        ),
      };
      cases.push(caseReport);
      options.onCaseDone?.(caseReport);
    }
  }

  const allTransportFailed =
    cases.length > 0 &&
    cases.every((c) =>
      c.runs.every(
        (r) =>
          typeof r.outputOrError === "object" &&
          r.outputOrError !== null &&
          "error" in r.outputOrError &&
          isTransportError(String((r.outputOrError as { error: string }).error)),
      ),
    );
  if (allTransportFailed) {
    throw new Error("EVAL_TRANSPORT_FAILURE");
  }

  const passedCount = cases.filter((c) => c.passed).length;
  const passRate = cases.length === 0 ? 0 : passedCount / cases.length;
  const threshold = options.threshold ?? DEFAULT_SUITE_THRESHOLD;
  const passed = passRate >= threshold;

  const driftPerCase: DriftEntry[] = [];
  for (const c of cases) {
    for (const [scorer, score] of Object.entries(c.scorerScores.soft)) {
      if (score < 1) driftPerCase.push({ input: c.input, softScorer: scorer, score });
    }
  }

  const firstCaseLang = datasets[0]?.cases[0]?.languagePair ?? DEFAULT_LANGUAGE_PAIR;

  return {
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startMs,
    suite: options.suite,
    languagePair: { source: firstCaseLang.source.code, target: firstCaseLang.target.code },
    cases,
    passRate,
    threshold,
    passed,
    drift: {
      casesWithSoftMisses: new Set(driftPerCase.map((d) => d.input)).size,
      perCase: driftPerCase,
    },
  };
}

function isTransportError(message: string): boolean {
  return (
    message === "NETWORK_OFFLINE" ||
    message === "INVALID_API_KEY" ||
    message === "GEMINI_REQUEST_FAILED" ||
    message === "GEMINI_EMPTY_RESPONSE"
  );
}
