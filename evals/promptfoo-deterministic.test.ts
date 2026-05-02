import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const deterministic = require("./promptfoo/assertions/deterministic.cjs") as (
  output: string,
  context: { vars?: Record<string, unknown> },
) => { pass: boolean; reason: string; componentResults: { pass: boolean; reason: string }[] };

function okOutput(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    status: "ok",
    input: "red herring",
    correctedWord: null,
    notAWord: false,
    senses: [
      {
        translation: "оманлива підказка",
        partOfSpeech: "idiom",
        example: "Ця підказка була оманливою.",
        exampleTranslation: "That clue was a red herring.",
      },
    ],
    ...overrides,
  });
}

describe("Promptfoo deterministic assertion", () => {
  it("passes a valid ok translation projection", () => {
    const result = deterministic(okOutput(), {
      vars: {
        expect: {
          status: "ok",
          targetScript: "Cyrillic",
          forbiddenTranslations: ["червоний оселедець"],
        },
      },
    });

    expect(result.pass).toBe(true);
  });

  it("fails when a forbidden literal translation appears", () => {
    const result = deterministic(
      okOutput({
        senses: [
          {
            translation: "червоний оселедець",
            partOfSpeech: "idiom",
            example: "x",
            exampleTranslation: "x",
          },
        ],
      }),
      {
        vars: {
          expect: {
            status: "ok",
            targetScript: "Cyrillic",
            forbiddenTranslations: ["червоний оселедець"],
          },
        },
      },
    );

    expect(result.pass).toBe(false);
    expect(result.reason).toContain("forbidden translation appeared");
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

  it("fails when the target script is wrong", () => {
    const result = deterministic(
      okOutput({
        senses: [
          {
            translation: "red herring",
            partOfSpeech: "idiom",
            example: "x",
            exampleTranslation: "x",
          },
        ],
      }),
      {
        vars: {
          expect: {
            status: "ok",
            targetScript: "Cyrillic",
          },
        },
      },
    );

    expect(result.pass).toBe(false);
    expect(result.reason).toContain("targetScript");
  });

  it("passes an expected WORD_NOT_FOUND projection", () => {
    const result = deterministic(
      JSON.stringify({
        status: "error",
        input: "xqfjvbn",
        error: "WORD_NOT_FOUND",
      }),
      {
        vars: {
          expect: {
            status: "error",
            error: "WORD_NOT_FOUND",
          },
        },
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
