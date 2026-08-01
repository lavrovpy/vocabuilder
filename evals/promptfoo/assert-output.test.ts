import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

interface GradingResult {
  pass: boolean;
  score: number;
  reason: string;
  componentResults: GradingResult[];
}

type AssertOutput = (output: string, context: { vars: Record<string, unknown> }) => GradingResult;
const assertOutput = require("./assert-output.cjs") as AssertOutput;

const baseVars = {
  input: "hello",
  sourceLanguageCode: "en",
  targetLanguageCode: "uk",
};

function successOutput(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    status: "ok",
    input: "hello",
    languagePair: {
      source: { code: "en", name: "English" },
      target: { code: "uk", name: "Ukrainian" },
    },
    correctedWord: null,
    senses: [
      {
        translation: "привіт",
        partOfSpeech: "interjection",
        example: "Привіт, радий тебе бачити.",
        exampleTranslation: "I said hello to my friend.",
      },
    ],
    ...overrides,
  });
}

describe("evaluation output contract assertion", () => {
  it("accepts a complete production success projection", () => {
    expect(assertOutput(successOutput(), { vars: baseVars })).toMatchObject({
      pass: true,
      score: 1,
      reason: "Application output contract satisfied.",
    });
  });

  it("accepts the evaluated source form capitalized at the start of a sentence", () => {
    const result = assertOutput(
      successOutput({
        senses: [
          {
            translation: "привіт",
            partOfSpeech: "interjection",
            example: "Привіт, як справи?",
            exampleTranslation: "Hello, how are you?",
          },
        ],
      }),
      { vars: baseVars },
    );

    expect(result.pass).toBe(true);
  });

  it("rejects duplicate senses and source examples that omit the exact evaluated form", () => {
    const duplicate = {
      translation: "привіт",
      partOfSpeech: "interjection",
      example: "Вітаю тебе.",
      exampleTranslation: "I greeted my friend.",
    };
    const result = assertOutput(successOutput({ senses: [duplicate, duplicate] }), { vars: baseVars });
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("must be unique");
    expect(result.reason).toContain("exact source form hello");
  });

  it("enforces correction and forbidden-translation expectations", () => {
    const result = assertOutput(
      successOutput({
        input: "red hering",
        correctedWord: "red herring",
        senses: [
          {
            translation: "червоний оселедець",
            partOfSpeech: "idiom",
            example: "Це була хибна підказка.",
            exampleTranslation: "That was a red herring.",
          },
        ],
      }),
      {
        vars: {
          ...baseVars,
          input: "red hering",
          expect: { correctedWord: "red herring", forbiddenTranslations: ["червоний оселедець"] },
        },
      },
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("known-wrong form");
  });

  it("accepts an exact projected outcome error", () => {
    const output = JSON.stringify({
      status: "error",
      input: "xqfjvbn",
      languagePair: {
        source: { code: "en", name: "English" },
        target: { code: "uk", name: "Ukrainian" },
      },
      error: "word-not-found",
    });
    const result = assertOutput(output, {
      vars: { ...baseVars, input: "xqfjvbn", expect: { status: "error", error: "word-not-found" } },
    });
    expect(result.pass).toBe(true);
  });
});
