import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

type UnknownRecord = Record<string, unknown>;

interface EvaluationRow {
  description: string;
  success: boolean;
  error: boolean;
  reason: string;
  metadata: Record<string, string>;
}

interface GroupStats {
  total: number;
  passed: number;
  failed: number;
  errors: number;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordAt(value: unknown, key: string): UnknownRecord | undefined {
  return isRecord(value) && isRecord(value[key]) ? value[key] : undefined;
}

function stringAt(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : undefined;
}

function rowsFromDocument(document: unknown): unknown[] {
  if (!isRecord(document)) throw new Error("Promptfoo report must be a JSON object.");
  if (Array.isArray(document.results)) return document.results;
  if (isRecord(document.results) && Array.isArray(document.results.results)) return document.results.results;
  if (isRecord(document.results) && Array.isArray(document.results.outputs)) return document.results.outputs;
  throw new Error("Promptfoo report does not contain a recognized results array.");
}

function redactSensitive(value: string): string {
  return value.replace(
    /(?:AIza[0-9A-Za-z_-]{10,}|github_pat_[0-9A-Za-z_]{10,}|ghp_[0-9A-Za-z]{10,}|sk-[0-9A-Za-z_-]{10,}|xox[baprs]-[0-9A-Za-z-]{10,})/g,
    "[REDACTED]",
  );
}

function extractReason(row: UnknownRecord): string {
  const gradingResult = recordAt(row, "gradingResult");
  const direct =
    stringAt(gradingResult, "reason") ??
    stringAt(row, "error") ??
    stringAt(row, "reason") ??
    "No failure reason recorded.";
  return redactSensitive(direct);
}

function extractMetadata(row: UnknownRecord): Record<string, string> {
  const testCase = recordAt(row, "testCase") ?? recordAt(row, "test") ?? {};
  const raw = recordAt(row, "metadata") ?? recordAt(testCase, "metadata") ?? {};
  const metadata = Object.fromEntries(
    Object.entries(raw).flatMap(([key, value]) =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? [[key, String(value)]]
        : [],
    ),
  );

  if (!metadata.pair) {
    const vars = recordAt(row, "vars") ?? recordAt(testCase, "vars") ?? {};
    const source = stringAt(vars, "sourceLanguageCode");
    const target = stringAt(vars, "targetLanguageCode");
    if (source && target) metadata.pair = `${source}->${target}`;
  }
  return metadata;
}

function extractRows(document: unknown): EvaluationRow[] {
  return rowsFromDocument(document).map((value, index) => {
    if (!isRecord(value)) throw new Error(`Promptfoo result row ${index + 1} is not an object.`);
    const testCase = recordAt(value, "testCase") ?? recordAt(value, "test") ?? {};
    const error = typeof value.error === "string" ? value.error.length > 0 : value.error === true;
    return {
      description:
        stringAt(value, "description") ?? stringAt(testCase, "description") ?? `Result ${index + 1}`,
      success: value.success === true,
      error,
      reason: extractReason(value),
      metadata: extractMetadata(value),
    };
  });
}

function blankStats(): GroupStats {
  return { total: 0, passed: 0, failed: 0, errors: 0 };
}

function addRow(stats: GroupStats, row: EvaluationRow): void {
  stats.total += 1;
  if (row.success) stats.passed += 1;
  else if (row.error) stats.errors += 1;
  else stats.failed += 1;
}

function groupRows(rows: EvaluationRow[], field: string): Map<string, GroupStats> {
  const groups = new Map<string, GroupStats>();
  for (const row of rows) {
    const key = row.metadata[field] ?? "unclassified";
    const stats = groups.get(key) ?? blankStats();
    addRow(stats, row);
    groups.set(key, stats);
  }
  return new Map([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function percentage(passed: number, total: number): string {
  return total === 0 ? "0.0%" : `${((passed / total) * 100).toFixed(1)}%`;
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function groupTable(title: string, groups: Map<string, GroupStats>): string {
  const lines = [
    `## ${title}`,
    "",
    "| Group | Pass rate | Passed | Failed | Errors | Total |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const [group, stats] of groups) {
    lines.push(
      `| ${escapeCell(group)} | ${percentage(stats.passed, stats.total)} | ${stats.passed} | ${stats.failed} | ${stats.errors} | ${stats.total} |`,
    );
  }
  return lines.join("\n");
}

function buildEvaluationReport(document: unknown, generatedAt = new Date()): string {
  const rows = extractRows(document);
  const overall = blankStats();
  rows.forEach((row) => addRow(overall, row));
  const unsuccessful = rows.filter((row) => !row.success);

  const sections = [
    "# Vocabuilder Evaluation Report",
    "",
    `Generated: ${generatedAt.toISOString()}`,
    "",
    `Overall: **${overall.passed}/${overall.total} passed (${percentage(overall.passed, overall.total)})**, ${overall.failed} failed, ${overall.errors} provider errors.`,
    "",
    groupTable("By language pair", groupRows(rows, "pair")),
    "",
    groupTable("By category", groupRows(rows, "category")),
    "",
    groupTable("By difficulty", groupRows(rows, "difficulty")),
    "",
    groupTable("By tier", groupRows(rows, "tier")),
  ];

  if (unsuccessful.length > 0) {
    sections.push(
      "",
      "## Failures and provider errors",
      "",
      "| Case | Pair | Category | Kind | Reason |",
      "| --- | --- | --- | --- | --- |",
      ...unsuccessful.map(
        (row) =>
          `| ${escapeCell(row.description)} | ${escapeCell(row.metadata.pair ?? "unclassified")} | ${escapeCell(row.metadata.category ?? "unclassified")} | ${row.error ? "error" : "failure"} | ${escapeCell(row.reason)} |`,
      ),
    );
  }

  return `${sections.join("\n")}\n`;
}

async function main(): Promise<void> {
  const inputPath = path.resolve(process.argv[2] ?? "evals/results/promptfoo.json");
  const outputPath = path.resolve(process.argv[3] ?? "evals/results/summary.md");
  const document = JSON.parse(await readFile(inputPath, "utf8")) as unknown;
  const report = buildEvaluationReport(document);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, report, "utf8");
  process.stdout.write(`Wrote evaluation summary to ${outputPath}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Evaluation report failed: ${message}\n`);
    process.exitCode = 1;
  });
}

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("buildEvaluationReport", () => {
    it("summarizes current Promptfoo JSON rows by the suite metadata", () => {
      const report = buildEvaluationReport(
        {
          results: {
            results: [
              {
                description: "en->uk | common | hello",
                success: true,
                metadata: { pair: "en->uk", category: "common", difficulty: "easy", tier: "smoke" },
              },
              {
                description: "en->uk | idiom | red herring",
                success: false,
                gradingResult: { reason: "Literal translation." },
                metadata: { pair: "en->uk", category: "idiom", difficulty: "hard", tier: "challenge" },
              },
            ],
          },
        },
        new Date("2026-07-13T10:00:00.000Z"),
      );

      expect(report).toContain("Overall: **1/2 passed (50.0%)**, 1 failed, 0 provider errors.");
      expect(report).toContain("| en->uk | 50.0% | 1 | 1 | 0 | 2 |");
      expect(report).toContain("| idiom | 0.0% | 0 | 1 | 0 | 1 |");
      expect(report).toContain("Literal translation.");
    });

    it("redacts likely API keys from failure reasons", () => {
      const report = buildEvaluationReport({
        results: [{ success: false, error: "request failed for AIza1234567890abcdef" }],
      });
      expect(report).toContain("[REDACTED]");
      expect(report).not.toContain("AIza1234567890abcdef");
    });
  });
}
