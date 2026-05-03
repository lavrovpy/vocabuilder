import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const deterministic = require("./promptfoo/assertions/deterministic.cjs") as (
  output: string,
  context: { vars?: Record<string, unknown> },
) => { pass: boolean; reason: string; componentResults: { pass: boolean; reason: string }[] };
const transformVars = require("./promptfoo/transform-vars.cjs") as (vars: Record<string, unknown>) => {
  expectJson: string;
};

function defaultSense(overrides: Record<string, unknown> = {}) {
  return {
    translation: "оманлива підказка",
    partOfSpeech: "idiom",
    example: "Ця підказка була оманливою.",
    exampleTranslation: "That clue was a red herring.",
    ...overrides,
  };
}

function okOutput(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    status: "ok",
    input: "red herring",
    languagePair: {
      source: { code: "en", name: "English" },
      target: { code: "uk", name: "Ukrainian" },
    },
    correctedWord: null,
    notAWord: false,
    senses: [defaultSense()],
    ...overrides,
  });
}

function caseVars(expect: Record<string, unknown> = {}) {
  return {
    input: "red herring",
    sourceLanguageCode: "en",
    sourceLanguageName: "English",
    targetLanguageCode: "uk",
    targetLanguageName: "Ukrainian",
    expect: {
      status: "ok",
      targetScript: "Cyrillic",
      sourceScript: "Latin",
      ...expect,
    },
  };
}

describe("Promptfoo deterministic assertion", () => {
  it("passes a valid ok translation projection", () => {
    const result = deterministic(okOutput(), {
      vars: caseVars(),
    });

    expect(result.pass).toBe(true);
  });

  it("fails when the projected language pair does not match the eval case", () => {
    const result = deterministic(
      okOutput({
        languagePair: {
          source: { code: "en", name: "English" },
          target: { code: "pl", name: "Polish" },
        },
      }),
      { vars: caseVars() },
    );

    expect(result.pass).toBe(false);
    expect(result.reason).toContain("language pair mismatch");
  });

  it("fails when required sense fields are empty", () => {
    const result = deterministic(okOutput({ senses: [defaultSense({ example: " " })] }), {
      vars: caseVars(),
    });

    expect(result.pass).toBe(false);
    expect(result.reason).toContain("sense fields");
  });

  it("checks configured sense count bounds", () => {
    const result = deterministic(okOutput(), {
      vars: caseVars({ minSenses: 2, maxSenses: 3 }),
    });

    expect(result.pass).toBe(false);
    expect(result.reason).toContain("sense count");
  });

  it("fails duplicate sense identities", () => {
    const result = deterministic(
      okOutput({
        senses: [
          defaultSense({ example: "Це була оманлива підказка." }),
          defaultSense({ example: "Підказка була оманливою." }),
        ],
      }),
      { vars: caseVars() },
    );

    expect(result.pass).toBe(false);
    expect(result.reason).toContain("duplicate translation+partOfSpeech");
  });

  it("checks expected typo corrections", () => {
    const result = deterministic(okOutput({ correctedWord: "red herring" }), {
      vars: {
        expect: {
          status: "ok",
          correctedWord: "red herring",
        },
      },
    });

    expect(result.pass).toBe(true);
  });

  it("fails unexpected corrections unless explicitly allowed", () => {
    const result = deterministic(okOutput({ correctedWord: "red hearing" }), {
      vars: caseVars(),
    });

    expect(result.pass).toBe(false);
    expect(result.reason).toContain("unexpected correction");
  });

  it("checks every exampleTranslation contains the input or corrected item", () => {
    const result = deterministic(
      okOutput({
        senses: [defaultSense({ exampleTranslation: "That clue was misleading." })],
      }),
      { vars: caseVars() },
    );

    expect(result.pass).toBe(false);
    expect(result.reason).toContain("exampleTranslation");
  });

  it("fails when the target script is wrong", () => {
    const result = deterministic(
      okOutput({
        senses: [defaultSense({ translation: "red herring" })],
      }),
      { vars: caseVars() },
    );

    expect(result.pass).toBe(false);
    expect(result.reason).toContain("targetScript");
  });

  it("checks source script when configured", () => {
    const result = deterministic(
      okOutput({
        senses: [defaultSense({ exampleTranslation: "Ця підказка була оманливою." })],
      }),
      { vars: caseVars() },
    );

    expect(result.pass).toBe(false);
    expect(result.reason).toContain("sourceScript");
  });

  it("checks source leakage only when configured", () => {
    const result = deterministic(
      okOutput({
        senses: [defaultSense({ example: "Цей red herring був очевидним." })],
      }),
      {
        vars: caseVars({
          targetScript: undefined,
          disallowSourceLeakage: true,
        }),
      },
    );

    expect(result.pass).toBe(false);
    expect(result.reason).toContain("source leakage");
  });

  it("checks optional part-of-speech expectations", () => {
    const result = deterministic(okOutput(), {
      vars: caseVars({ partOfSpeechAny: ["noun", "verb"] }),
    });

    expect(result.pass).toBe(false);
    expect(result.reason).toContain("partOfSpeechAny");
  });

  it("passes an expected WORD_NOT_FOUND projection", () => {
    const result = deterministic(
      JSON.stringify({
        status: "error",
        input: "xqfjvbn",
        languagePair: {
          source: { code: "en", name: "English" },
          target: { code: "uk", name: "Ukrainian" },
        },
        error: "WORD_NOT_FOUND",
      }),
      {
        vars: caseVars({ status: "error", error: "WORD_NOT_FOUND" }),
      },
    );

    expect(result.pass).toBe(true);
  });

  it("fails malformed JSON", () => {
    const result = deterministic("not json", { vars: { expect: { status: "ok" } } });

    expect(result.pass).toBe(false);
    expect(result.reason).toContain("JSON");
  });
});

describe("Promptfoo rubric variables", () => {
  it("serializes expected fields before rendering the LLM judge rubric", () => {
    const result = transformVars({
      expect: {
        status: "ok",
        targetScript: "Cyrillic",
        partOfSpeechAny: ["idiom", "expression"],
      },
    });

    expect(result.expectJson).toContain('"status": "ok"');
    expect(result.expectJson).toContain('"targetScript": "Cyrillic"');
    expect(result.expectJson).toContain('"partOfSpeechAny"');
    expect(result.expectJson).not.toBe("[object Object]");
  });

  it("uses the serialized expectations var in promptfoo config", () => {
    const config = readFileSync(join(import.meta.dirname, "promptfooconfig.yaml"), "utf8");

    expect(config).toContain("transformVars: file://promptfoo/transform-vars.cjs");
    expect(config).toContain("{{expectJson}}");
    expect(config).not.toContain("{{expect}}");
  });
});
