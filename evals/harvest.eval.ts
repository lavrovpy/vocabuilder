#!/usr/bin/env tsx
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCase } from "./executor";
import { EvalDatasetSchema, type EvalCase, type EvalDataset } from "./types";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, "data");
const HARVEST_DIR = resolve(HERE, "harvest");
const HARVEST_RUNS = 20;
const HARVEST_TEMPERATURE = 0.7;

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

function loadDatasets(): { filename: string; dataset: EvalDataset }[] {
  return readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((filename) => {
      const path = join(DATA_DIR, filename);
      const raw = JSON.parse(readFileSync(path, "utf8"));
      return { filename, dataset: EvalDatasetSchema.parse(raw) };
    });
}

type Pair = { translation: string; partOfSpeech: string; runs: number };

async function harvestCase(c: EvalCase, apiKey: string): Promise<Pair[]> {
  const counts = new Map<string, Pair>();
  const runs = await runCase(c, apiKey, { runs: HARVEST_RUNS, temperature: HARVEST_TEMPERATURE });
  for (const run of runs) {
    if (run.kind !== "ok") continue;
    for (const sense of run.output.senses) {
      const key = `${sense.translation}${sense.partOfSpeech}`;
      const existing = counts.get(key);
      if (existing) existing.runs += 1;
      else counts.set(key, { translation: sense.translation, partOfSpeech: sense.partOfSpeech, runs: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.runs - a.runs);
}

function alreadyMatched(translation: string, regexes: { source: string; flags?: string }[]): boolean {
  return regexes.some((r) => new RegExp(r.source, r.flags).test(translation));
}

function regexLiteralsFromCase(field: unknown): { source: string; flags?: string }[] {
  if (!Array.isArray(field)) return [];
  return field.filter(
    (x): x is { source: string; flags?: string } =>
      typeof x === "object" && x !== null && typeof (x as { source: unknown }).source === "string",
  );
}

function rawCase(filename: string, input: string): { preferredTranslation: { source: string; flags?: string }[]; forbiddenTranslation: { source: string; flags?: string }[] } {
  const raw = JSON.parse(readFileSync(join(DATA_DIR, filename), "utf8"));
  const c = (raw.cases as { input: string; target: Record<string, unknown> }[]).find((x) => x.input === input);
  return {
    preferredTranslation: regexLiteralsFromCase(c?.target.preferredTranslation),
    forbiddenTranslation: regexLiteralsFromCase(c?.target.forbiddenTranslation),
  };
}

function buildReviewMarkdown(filename: string, dataset: EvalDataset, casePairs: Map<string, Pair[]>): string {
  const lines: string[] = [];
  lines.push(`# Harvest review: ${filename}`);
  lines.push(`Generated: ${new Date().toISOString()} (${HARVEST_RUNS} runs/case, temperature=${HARVEST_TEMPERATURE})`);
  lines.push("");
  lines.push(
    "Mark each line by replacing `[ ]` with `[VALID]` (merge into `preferredTranslation`), `[INVALID]` (skip), or `[FORBID]` (append to `forbiddenTranslation`).",
  );
  lines.push("Lines marked `← already preferred` or `← already forbidden` are sanity checks; you can ignore them.");
  lines.push("");

  for (const c of dataset.cases) {
    const pairs = casePairs.get(c.input) ?? [];
    const raw = rawCase(filename, c.input);
    lines.push(`## ${c.input}`);
    if (raw.preferredTranslation.length > 0) {
      lines.push(`Already in preferredTranslation: ${raw.preferredTranslation.map((r) => r.source).join(", ")}`);
    }
    if (raw.forbiddenTranslation.length > 0) {
      lines.push(`Already in forbiddenTranslation: ${raw.forbiddenTranslation.map((r) => r.source).join(", ")}`);
    }
    lines.push("");
    if (pairs.length === 0) {
      lines.push("_No successful runs — nothing to harvest._");
      lines.push("");
      continue;
    }
    lines.push("Observed translations (mark each VALID, INVALID, or FORBID):");
    for (const p of pairs) {
      const inPreferred = alreadyMatched(p.translation, raw.preferredTranslation);
      const inForbidden = alreadyMatched(p.translation, raw.forbiddenTranslation);
      const tag = inForbidden ? "  ← already forbidden" : inPreferred ? "  ← already preferred" : "";
      lines.push(`- [ ] "${p.translation}" (${p.partOfSpeech}) — ${p.runs} runs${tag}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

const APPLY_LINE_RE = /^- \[(\w+)\]\s+"([^"]+)"\s+\(([^)]+)\)\s+—\s+(\d+)\s+runs/;

type AppliedRow = { decision: "valid" | "invalid" | "forbid"; translation: string };

function parseDecisionsFromReview(content: string): { caseInput: string; rows: AppliedRow[] }[] {
  const out: { caseInput: string; rows: AppliedRow[] }[] = [];
  const lines = content.split("\n");
  let current: { caseInput: string; rows: AppliedRow[] } | null = null;
  for (const line of lines) {
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      if (current) out.push(current);
      current = { caseInput: heading[1].trim(), rows: [] };
      continue;
    }
    const m = APPLY_LINE_RE.exec(line);
    if (!m || !current) continue;
    const tag = m[1].toUpperCase();
    let decision: AppliedRow["decision"];
    if (tag === "VALID" || tag === "V") decision = "valid";
    else if (tag === "INVALID" || tag === "I") decision = "invalid";
    else if (tag === "FORBID" || tag === "F") decision = "forbid";
    else continue;
    current.rows.push({ decision, translation: m[2] });
  }
  if (current) out.push(current);
  return out;
}

function applyDecisions(reviewPath: string): void {
  const content = readFileSync(reviewPath, "utf8");
  const headerMatch = /^# Harvest review: (\S+)/m.exec(content);
  if (!headerMatch) {
    throw new Error(`Could not find dataset filename header in ${reviewPath}`);
  }
  const filename = headerMatch[1];
  const datasetPath = join(DATA_DIR, filename);
  const datasetRaw = JSON.parse(readFileSync(datasetPath, "utf8")) as {
    name: string;
    cases: {
      input: string;
      target: {
        preferredTranslation?: { source: string; flags?: string }[];
        forbiddenTranslation?: { source: string; flags?: string }[];
      };
    }[];
  };

  const decisions = parseDecisionsFromReview(content);
  let validAdded = 0;
  let forbidAdded = 0;

  for (const dec of decisions) {
    const caseObj = datasetRaw.cases.find((c) => c.input === dec.caseInput);
    if (!caseObj) continue;
    for (const row of dec.rows) {
      const literal = { source: row.translation, flags: "i" };
      if (row.decision === "valid") {
        caseObj.target.preferredTranslation = caseObj.target.preferredTranslation ?? [];
        if (!caseObj.target.preferredTranslation.some((r) => r.source === row.translation)) {
          caseObj.target.preferredTranslation.push(literal);
          validAdded += 1;
        }
      } else if (row.decision === "forbid") {
        caseObj.target.forbiddenTranslation = caseObj.target.forbiddenTranslation ?? [];
        if (!caseObj.target.forbiddenTranslation.some((r) => r.source === row.translation)) {
          caseObj.target.forbiddenTranslation.push(literal);
          forbidAdded += 1;
        }
      }
    }
  }

  writeFileSync(datasetPath, JSON.stringify(datasetRaw, null, 2) + "\n");
  console.log(`Applied review for ${filename}: ${validAdded} VALID added to preferredTranslation, ${forbidAdded} FORBID added to forbiddenTranslation.`);
}

async function harvestMode(apiKey: string): Promise<void> {
  if (!existsSync(HARVEST_DIR)) mkdirSync(HARVEST_DIR, { recursive: true });
  const datasets = loadDatasets();
  const totalCases = datasets.reduce((acc, d) => acc + d.dataset.cases.length, 0);
  console.log(`Harvesting ${totalCases} cases × ${HARVEST_RUNS} runs at temperature=${HARVEST_TEMPERATURE}.`);
  console.log(`This will make ~${totalCases * HARVEST_RUNS} Gemini API calls.\n`);

  for (const { filename, dataset } of datasets) {
    console.log(`\n--- ${filename} ---`);
    const casePairs = new Map<string, Pair[]>();
    for (const c of dataset.cases) {
      process.stdout.write(`  ${c.input} ... `);
      const start = Date.now();
      const pairs = await harvestCase(c, apiKey);
      casePairs.set(c.input, pairs);
      console.log(`${pairs.length} distinct pairs (${Date.now() - start}ms)`);
    }
    const md = buildReviewMarkdown(filename, dataset, casePairs);
    const outPath = join(HARVEST_DIR, filename.replace(/\.json$/, ".review.md"));
    writeFileSync(outPath, md);
    console.log(`Wrote ${outPath}`);
  }

  console.log("\nDone. Open the review files, mark each line VALID/INVALID/FORBID, then run:");
  console.log("  npm run eval:harvest -- --apply evals/harvest/<dataset>.review.md");
}

async function main(): Promise<number> {
  loadDotenv();

  const applyIdx = process.argv.indexOf("--apply");
  if (applyIdx >= 0) {
    const reviewPath = process.argv[applyIdx + 1];
    if (!reviewPath) {
      console.error("ERROR: --apply requires a review file path.");
      return 2;
    }
    applyDecisions(resolve(reviewPath));
    return 0;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("ERROR: GEMINI_API_KEY is not set. Add it to your environment or .env file.");
    return 2;
  }
  await harvestMode(apiKey);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("Unhandled harvest error:", err);
    process.exit(2);
  },
);
