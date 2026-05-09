import { describe, it, expect } from "vitest";
import VocabuilderTranslateWordProvider, { EvalVarsSchema, ProviderConfigSchema } from "./provider";

describe("EvalVarsSchema", () => {
  const validVars = {
    sourceLanguageCode: "en",
    sourceLanguageName: "English",
    targetLanguageCode: "uk",
    targetLanguageName: "Ukrainian",
  };

  it("transforms required vars into a LanguagePair", () => {
    const result = EvalVarsSchema.parse(validVars);
    expect(result).toEqual({
      pair: {
        source: { code: "en", name: "English" },
        target: { code: "uk", name: "Ukrainian" },
      },
      input: undefined,
    });
  });

  it("carries through optional input when provided", () => {
    const result = EvalVarsSchema.parse({ ...validVars, input: "hello" });
    expect(result.input).toBe("hello");
  });

  it("trims surrounding whitespace from string fields", () => {
    const result = EvalVarsSchema.parse({
      sourceLanguageCode: "  en  ",
      sourceLanguageName: " English ",
      targetLanguageCode: "uk",
      targetLanguageName: "Ukrainian",
      input: "  hello  ",
    });
    expect(result.pair.source).toEqual({ code: "en", name: "English" });
    expect(result.input).toBe("hello");
  });

  it("rejects whitespace-only strings as missing", () => {
    const result = EvalVarsSchema.safeParse({ ...validVars, sourceLanguageCode: "   " });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path.join("."))).toContain("sourceLanguageCode");
    }
  });

  it("reports missing required fields by path", () => {
    const result = EvalVarsSchema.safeParse({ sourceLanguageCode: "en", sourceLanguageName: "English" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("targetLanguageCode");
      expect(paths).toContain("targetLanguageName");
    }
  });
});

describe("ProviderConfigSchema", () => {
  it("accepts a numeric temperature", () => {
    expect(ProviderConfigSchema.parse({ temperature: 0 })).toEqual({ temperature: 0 });
    expect(ProviderConfigSchema.parse({ temperature: 0.7 })).toEqual({ temperature: 0.7 });
  });

  it("rejects missing temperature", () => {
    const result = ProviderConfigSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path.join("."))).toContain("temperature");
    }
  });

  it("rejects non-numeric temperature", () => {
    expect(ProviderConfigSchema.safeParse({ temperature: "0" }).success).toBe(false);
  });
});

describe("VocabuilderTranslateWordProvider constructor", () => {
  // Promptfoo silently treating a missing temperature as 0 would mask config bugs
  // and let two YAMLs diverge from the documented eval setup. Fail loud at load.
  it("throws when promptfoo passes no config", () => {
    expect(() => new VocabuilderTranslateWordProvider()).toThrow(/temperature/);
  });

  it("throws when promptfoo passes a config without temperature", () => {
    expect(() => new VocabuilderTranslateWordProvider({ config: {} })).toThrow(/temperature/);
  });

  it("accepts a valid config", () => {
    expect(() => new VocabuilderTranslateWordProvider({ config: { temperature: 0 } })).not.toThrow();
  });
});
