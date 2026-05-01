#!/usr/bin/env tsx
import { readFileSync, writeFileSync, renameSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCase } from "./executor";
import {
  EvalDatasetSchema,
  HarvestReviewSchema,
  type EvalCase,
  type EvalDataset,
  type HarvestReview,
  type HarvestReviewCase,
  type HarvestReviewObservation,
} from "./types";

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
      const key = `${sense.translation}${sense.partOfSpeech}`;
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function regexLiteralsFromCase(field: unknown): { source: string; flags?: string }[] {
  if (!Array.isArray(field)) return [];
  return field.filter(
    (x): x is { source: string; flags?: string } =>
      typeof x === "object" && x !== null && typeof (x as { source: unknown }).source === "string",
  );
}

type RawDataset = {
  name: string;
  cases: {
    input: string;
    target: {
      preferredTranslation?: { source: string; flags?: string }[];
      forbiddenTranslation?: { source: string; flags?: string }[];
    };
  }[];
};

function rawCase(
  raw: RawDataset,
  input: string,
): { preferredTranslation: { source: string; flags?: string }[]; forbiddenTranslation: { source: string; flags?: string }[] } {
  const c = raw.cases.find((x) => x.input === input);
  return {
    preferredTranslation: regexLiteralsFromCase(c?.target.preferredTranslation),
    forbiddenTranslation: regexLiteralsFromCase(c?.target.forbiddenTranslation),
  };
}

export function buildReview(
  filename: string,
  dataset: EvalDataset,
  rawDataset: RawDataset,
  casePairs: Map<string, Pair[]>,
  generatedAt: string = new Date().toISOString(),
): HarvestReview {
  const cases: HarvestReviewCase[] = dataset.cases.map((c) => {
    const raw = rawCase(rawDataset, c.input);
    const pairs = casePairs.get(c.input) ?? [];
    const observations: HarvestReviewObservation[] = pairs.map((p) => {
      const inForbidden = alreadyMatched(p.translation, raw.forbiddenTranslation);
      const inPreferred = alreadyMatched(p.translation, raw.preferredTranslation);
      const tag = inForbidden ? "alreadyForbidden" : inPreferred ? "alreadyPreferred" : null;
      return {
        translation: p.translation,
        partOfSpeech: p.partOfSpeech,
        runs: p.runs,
        tag,
        decision: null,
      };
    });
    return {
      input: c.input,
      alreadyPreferred: raw.preferredTranslation,
      alreadyForbidden: raw.forbiddenTranslation,
      observations,
    };
  });

  return {
    version: 1,
    dataset: filename,
    generatedAt,
    config: { runs: HARVEST_RUNS, temperature: HARVEST_TEMPERATURE },
    cases,
  };
}

export type MergeStats = {
  validAdded: number;
  forbidAdded: number;
  pendingDecisions: number;
  staleCases: string[];
  editedTranslations: { caseInput: string; translation: string }[];
};

export function mergeDecisions(
  rawDataset: RawDataset,
  review: HarvestReview,
): { dataset: RawDataset; stats: MergeStats } {
  const dataset: RawDataset = JSON.parse(JSON.stringify(rawDataset));
  const stats: MergeStats = {
    validAdded: 0,
    forbidAdded: 0,
    pendingDecisions: 0,
    staleCases: [],
    editedTranslations: [],
  };

  for (const reviewCase of review.cases) {
    const caseObj = dataset.cases.find((c) => c.input === reviewCase.input);
    if (!caseObj) {
      stats.staleCases.push(reviewCase.input);
      continue;
    }

    const originalTranslations = new Set(reviewCase.observations.map((o) => o.translation));

    for (const obs of reviewCase.observations) {
      if (obs.decision === null) {
        stats.pendingDecisions += 1;
        continue;
      }

      if (!originalTranslations.has(obs.translation)) {
        stats.editedTranslations.push({ caseInput: reviewCase.input, translation: obs.translation });
      }

      const source = escapeRegex(obs.translation);
      const literal = { source, flags: "i" };

      if (obs.decision === "v") {
        caseObj.target.preferredTranslation = caseObj.target.preferredTranslation ?? [];
        if (!caseObj.target.preferredTranslation.some((r) => r.source === source)) {
          caseObj.target.preferredTranslation.push(literal);
          stats.validAdded += 1;
        }
      } else if (obs.decision === "f") {
        caseObj.target.forbiddenTranslation = caseObj.target.forbiddenTranslation ?? [];
        if (!caseObj.target.forbiddenTranslation.some((r) => r.source === source)) {
          caseObj.target.forbiddenTranslation.push(literal);
          stats.forbidAdded += 1;
        }
      }
    }
  }

  return { dataset, stats };
}

function applyDecisions(reviewPath: string): void {
  const reviewRaw = JSON.parse(readFileSync(reviewPath, "utf8"));
  const review = HarvestReviewSchema.parse(reviewRaw);

  const datasetPath = join(DATA_DIR, review.dataset);
  const datasetRaw = JSON.parse(readFileSync(datasetPath, "utf8")) as RawDataset;

  const { dataset: mutated, stats } = mergeDecisions(datasetRaw, review);

  EvalDatasetSchema.parse(mutated);

  const tmpPath = `${datasetPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(mutated, null, 2) + "\n");
  renameSync(tmpPath, datasetPath);

  console.log(
    `Applied review for ${review.dataset}: ${stats.validAdded} VALID added to preferredTranslation, ${stats.forbidAdded} FORBID added to forbiddenTranslation.`,
  );
  if (stats.pendingDecisions > 0) {
    console.log(`  ${stats.pendingDecisions} pending (null) decision(s) ignored.`);
  }
  if (stats.staleCases.length > 0) {
    console.log(`  Warning: ${stats.staleCases.length} case(s) in review not found in dataset: ${stats.staleCases.join(", ")}`);
  }
  if (stats.editedTranslations.length > 0) {
    console.log(`  Warning: ${stats.editedTranslations.length} translation(s) appear edited from original observations:`);
    for (const e of stats.editedTranslations) {
      console.log(`    - "${e.translation}" in case "${e.caseInput}"`);
    }
  }
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
    const rawDataset = JSON.parse(readFileSync(join(DATA_DIR, filename), "utf8")) as RawDataset;
    const review = buildReview(filename, dataset, rawDataset, casePairs);
    const outPath = join(HARVEST_DIR, filename.replace(/\.json$/, ".review.json"));
    writeFileSync(outPath, JSON.stringify(review, null, 2) + "\n");
    console.log(`Wrote ${outPath}`);
  }

  console.log('\nDone. Open the review files, mark each "decision" null as "v" / "i" / "f", then run:');
  console.log("  npm run eval:harvest -- --apply evals/harvest/<dataset>.review.json");
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

const isDirectRun = (() => {
  if (typeof process.argv[1] !== "string") return false;
  return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
})();

if (isDirectRun) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error("Unhandled harvest error:", err);
      process.exit(2);
    },
  );
}
