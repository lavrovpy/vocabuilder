#!/usr/bin/env tsx
import { readFileSync, writeFileSync, readdirSync, existsSync, appendFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EvalDatasetSchema, type AggregateReport, type CaseReport, type EvalDataset } from "./types";
import { runEvals, DEFAULT_SUITE_THRESHOLD } from "./runner";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, "data");
const SMOKE_DATASETS = ["baseline.json"];

function loadDotenv(): void {
  const envPath = resolve(HERE, "..", ".env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function loadDatasets(suite: "smoke" | "full"): EvalDataset[] {
  const filenames =
    suite === "smoke"
      ? SMOKE_DATASETS
      : readdirSync(DATA_DIR).filter((f) => f.endsWith(".json")).sort();

  return filenames.map((fname) => {
    const path = join(DATA_DIR, fname);
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const result = EvalDatasetSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`Invalid dataset ${fname}: ${result.error.message}`);
    }
    return result.data;
  });
}

function groupCasesByDataset(report: AggregateReport): Map<string, CaseReport[]> {
  const out = new Map<string, CaseReport[]>();
  for (const c of report.cases) {
    if (!out.has(c.dataset)) out.set(c.dataset, []);
    out.get(c.dataset)!.push(c);
  }
  return out;
}

function formatReport(report: AggregateReport): string {
  const lines: string[] = [];
  lines.push(`VOCABUILDER PROMPT EVAL — ${report.startedAt}`);
  lines.push(
    `  Suite: ${report.suite} (${report.cases.length} cases, ${report.durationMs}ms)`,
  );
  lines.push(`  Pair:  ${report.languagePair.source} → ${report.languagePair.target} (per-case overrides applied)`);
  lines.push("");
  lines.push("  HARD TIER (CI gate)");

  const grouped = groupCasesByDataset(report);
  for (const [name, cases] of grouped) {
    const passed = cases.filter((c) => c.passed).length;
    const total = cases.length;
    const mark = passed === total ? "✓" : "✗";
    let line = `    ${name.padEnd(18)} [${passed}/${total}]  ${mark}`;
    if (passed < total) {
      const failed = cases.filter((c) => !c.passed).map((c) => failureReason(c)).join("; ");
      line += `  (${failed})`;
    }
    lines.push(line);
  }
  const passedCount = report.cases.filter((c) => c.passed).length;
  const total = report.cases.length;
  lines.push(
    `    PASS RATE: ${passedCount}/${total} (${(report.passRate * 100).toFixed(1)}%)  threshold ${(report.threshold * 100).toFixed(0)}%  →  ${report.passed ? "PASS" : "FAIL"}`,
  );

  lines.push("");
  lines.push("  SOFT TIER (drift, informational)");
  if (report.drift.perCase.length === 0) {
    lines.push("    No drift on any soft-scored case.");
  } else {
    const sorted = [...report.drift.perCase].sort((a, b) => a.score - b.score);
    for (const d of sorted) {
      lines.push(
        `    ${d.input.padEnd(20)} ${d.softScorer.padEnd(24)} ${d.score.toFixed(2)}`,
      );
    }
  }
  return lines.join("\n");
}

function failureReason(c: CaseReport): string {
  const failingHard = Object.entries(c.scorerScores.hard)
    .filter(([, score]) => score < 1)
    .map(([name, score]) => `${c.input}: ${name}=${score.toFixed(2)}`);
  return failingHard.join(", ") || c.input;
}

function formatMarkdownSummary(report: AggregateReport): string {
  const passedCount = report.cases.filter((c) => c.passed).length;
  const total = report.cases.length;
  const status = report.passed ? "✅ PASS" : "❌ FAIL";
  const lines: string[] = [];
  lines.push(`# Vocabuilder Prompt Eval — ${status}`);
  lines.push("");
  lines.push(`**Suite:** ${report.suite}  •  **Cases:** ${total}  •  **Pass rate:** ${(report.passRate * 100).toFixed(1)}% (threshold ${(report.threshold * 100).toFixed(0)}%)`);
  lines.push("");
  lines.push("## Hard tier (CI gate)");
  lines.push("");
  lines.push("| Dataset | Pass | Total |");
  lines.push("|---|---|---|");
  for (const [name, cases] of groupCasesByDataset(report)) {
    const passed = cases.filter((c) => c.passed).length;
    lines.push(`| ${name} | ${passed} | ${cases.length} |`);
  }
  lines.push("");

  const failed = report.cases.filter((c) => !c.passed);
  if (failed.length > 0) {
    lines.push("### Hard-tier failures");
    lines.push("");
    for (const c of failed) {
      const fails = Object.entries(c.scorerScores.hard)
        .filter(([, s]) => s < 1)
        .map(([name, s]) => `\`${name}\`=${s.toFixed(2)}`)
        .join(", ");
      lines.push(`- **${c.input}** (${c.dataset}): ${fails}`);
    }
    lines.push("");
  }

  lines.push("## Soft tier (drift, informational)");
  lines.push("");
  if (report.drift.perCase.length === 0) {
    lines.push("_No drift on any soft-scored case._");
  } else {
    lines.push("| Case | Scorer | Score |");
    lines.push("|---|---|---|");
    for (const d of report.drift.perCase) {
      lines.push(`| ${d.input} | \`${d.softScorer}\` | ${d.score.toFixed(2)} |`);
    }
  }
  lines.push("");
  lines.push(`Total runtime: ${(report.durationMs / 1000).toFixed(1)}s`);
  return lines.join("\n");
}

async function main(): Promise<number> {
  loadDotenv();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("ERROR: GEMINI_API_KEY is not set. Add it to your environment or .env file.");
    return 2;
  }

  const suite = (process.env.EVAL_SUITE === "smoke" ? "smoke" : "full") as "smoke" | "full";
  const thresholdEnv = process.env.EVAL_THRESHOLD;
  const threshold = thresholdEnv ? Number(thresholdEnv) : DEFAULT_SUITE_THRESHOLD;
  if (Number.isNaN(threshold) || threshold <= 0 || threshold > 1) {
    console.error(`ERROR: EVAL_THRESHOLD=${thresholdEnv} is not a valid number in (0, 1].`);
    return 2;
  }

  let datasets: EvalDataset[];
  try {
    datasets = loadDatasets(suite);
  } catch (err) {
    console.error(`ERROR loading datasets: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }

  const totalCases = datasets.reduce((acc, d) => acc + d.cases.length, 0);
  console.log(`Running ${suite} suite: ${totalCases} cases across ${datasets.length} dataset(s).`);

  let report: AggregateReport;
  try {
    report = await runEvals(datasets, {
      apiKey,
      suite,
      threshold,
      onCaseDone: (c) => {
        const mark = c.passed ? "✓" : "✗";
        process.stdout.write(`  ${mark} ${c.dataset}/${c.input}\n`);
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "EVAL_TRANSPORT_FAILURE") {
      console.error("\nERROR: All eval cases failed at transport layer (network / API key / Gemini outage).");
      console.error("This is not a prompt regression — investigate connectivity before re-running.");
      return 2;
    }
    throw err;
  }

  console.log("\n" + formatReport(report));

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactPath = resolve(HERE, `results-${ts}.json`);
  writeFileSync(artifactPath, JSON.stringify(report, null, 2));
  console.log(`\nArtifact: ${artifactPath}`);

  const stepSummary = process.env.GITHUB_STEP_SUMMARY;
  if (stepSummary) {
    appendFileSync(stepSummary, formatMarkdownSummary(report) + "\n");
  }

  return report.passed ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("Unhandled eval error:", err);
    process.exit(2);
  },
);
