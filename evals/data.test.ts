import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EvalDatasetSchema } from "./types";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, "data");

function listDatasetFiles(): string[] {
  return readdirSync(DATA_DIR).filter((f) => f.endsWith(".json")).sort();
}

describe("eval dataset schemas", () => {
  const files = listDatasetFiles();

  it("finds at least one dataset", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`parses ${file} cleanly under EvalDatasetSchema`, () => {
      const raw = JSON.parse(readFileSync(join(DATA_DIR, file), "utf8"));
      const result = EvalDatasetSchema.safeParse(raw);
      if (!result.success) {
        throw new Error(`${file}: ${JSON.stringify(result.error.issues, null, 2)}`);
      }
      expect(result.data.cases.length).toBeGreaterThan(0);
    });
  }

  it("ensures every case has a non-empty input", () => {
    for (const file of listDatasetFiles()) {
      const raw = JSON.parse(readFileSync(join(DATA_DIR, file), "utf8"));
      const data = EvalDatasetSchema.parse(raw);
      for (const c of data.cases) {
        expect(c.input.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("ensures negative cases either expect notAWord or have a forbidden translation", () => {
    for (const file of listDatasetFiles()) {
      const raw = JSON.parse(readFileSync(join(DATA_DIR, file), "utf8"));
      const data = EvalDatasetSchema.parse(raw);
      for (const c of data.cases) {
        if (c.category !== "negative") continue;
        const hasNegativeIntent =
          c.target.expectNotAWord === true ||
          (Array.isArray(c.target.forbiddenTranslation) && c.target.forbiddenTranslation.length > 0);
        if (!hasNegativeIntent) {
          throw new Error(
            `${file}: case "${c.input}" is negative but has no expectNotAWord and no forbiddenTranslation`,
          );
        }
      }
    }
  });
});
