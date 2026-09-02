import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { normalizeWordInput } from "../../src/lib/input";
import { LANGUAGES } from "../../src/lib/languages";

const require = createRequire(import.meta.url);

interface EvalCase {
  description: string;
  metadata: {
    caseId: string;
    pair: string;
    sourceLanguage: string;
    targetLanguage: string;
    category: string;
    difficulty: string;
    tier: string;
    suite: string;
    direction: string;
  };
  vars: {
    input: string;
    sourceLanguageCode: string;
    sourceLanguageName: string;
    targetLanguageCode: string;
    targetLanguageName: string;
    intent: string;
    expect?: {
      status?: string;
      error?: string;
      correctedWord?: string;
      forbiddenTranslations?: string[];
    };
  };
}

type GenerateCases = () => Promise<EvalCase[]>;
const generateCases = require("./cases.cjs") as GenerateCases;

describe("multilingual evaluation suite", () => {
  it("contains 96 standard and 272 matrix cases with unique, complete classifications", async () => {
    const cases = await generateCases();
    expect(cases).toHaveLength(368);
    expect(new Set(cases.map((testCase) => testCase.metadata.caseId)).size).toBe(368);
    expect(cases.filter((testCase) => testCase.metadata.suite === "standard")).toHaveLength(96);
    expect(cases.filter((testCase) => testCase.metadata.suite === "matrix")).toHaveLength(272);

    for (const testCase of cases) {
      expect(testCase.description).toContain(testCase.vars.input);
      expect(testCase.vars.intent.trim().length).toBeGreaterThan(20);
      expect(["easy", "medium", "hard"]).toContain(testCase.metadata.difficulty);
      expect(["smoke", "core", "challenge", "contract", "matrix"]).toContain(testCase.metadata.tier);
      expect(["standard", "matrix"]).toContain(testCase.metadata.suite);
      expect(testCase.metadata.pair).toBe(
        `${testCase.vars.sourceLanguageCode}->${testCase.vars.targetLanguageCode}`,
      );
    }
  });

  it("covers every supported non-English language in both directions through English", async () => {
    const cases = (await generateCases()).filter((testCase) => testCase.metadata.suite === "standard");
    const supported = new Map(LANGUAGES.map((language) => [language.code, language.name]));
    const suiteCodes = new Set<string>();

    for (const testCase of cases) {
      suiteCodes.add(testCase.vars.sourceLanguageCode);
      suiteCodes.add(testCase.vars.targetLanguageCode);
      expect(testCase.vars.sourceLanguageName).toBe(supported.get(testCase.vars.sourceLanguageCode));
      expect(testCase.vars.targetLanguageName).toBe(supported.get(testCase.vars.targetLanguageCode));
      expect(testCase.vars.sourceLanguageCode).not.toBe(testCase.vars.targetLanguageCode);
    }

    expect(suiteCodes).toEqual(new Set(supported.keys()));
    for (const code of supported.keys()) {
      if (code === "en") continue;
      expect(cases.filter((testCase) => testCase.metadata.pair === `en->${code}`).length).toBeGreaterThanOrEqual(2);
      expect(cases.filter((testCase) => testCase.metadata.pair === `${code}->en`).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("covers all 272 directed pairs in the optional common-word matrix", async () => {
    const matrix = (await generateCases()).filter((testCase) => testCase.metadata.suite === "matrix");
    const expectedPairs = LANGUAGES.flatMap((source) =>
      LANGUAGES.filter((target) => target.code !== source.code).map(
        (target) => `${source.code}->${target.code}`,
      ),
    );
    expect(new Set(matrix.map((testCase) => testCase.metadata.pair))).toEqual(new Set(expectedPairs));
    expect(matrix.every((testCase) => testCase.metadata.category === "common-matrix")).toBe(true);
  });

  it("keeps a deterministic 12-case smoke tier spanning Latin, Cyrillic, and CJK inputs", async () => {
    const smoke = (await generateCases()).filter((testCase) => testCase.metadata.tier === "smoke");
    expect(smoke).toHaveLength(12);
    expect(smoke.some((testCase) => /\p{Script=Cyrillic}/u.test(testCase.vars.input))).toBe(true);
    expect(smoke.some((testCase) => /\p{Script=Han}/u.test(testCase.vars.input))).toBe(true);
    expect(smoke.some((testCase) => /\p{Script=Latin}/u.test(testCase.vars.input))).toBe(true);
  });

  it("sends only application-valid vocabulary inputs except the explicit validation case", async () => {
    for (const testCase of await generateCases()) {
      const normalized = normalizeWordInput(testCase.vars.input);
      if (testCase.vars.expect?.error === "invalid-word-input") {
        expect(normalized).toBeNull();
      } else {
        expect(normalized, testCase.metadata.caseId).toBe(testCase.vars.input);
      }
    }
  });
});
