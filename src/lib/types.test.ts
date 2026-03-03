import { describe, it, expect } from "vitest";
import {
  GeminiResponseSchema,
  TranslationSchema,
} from "./types";

describe("GeminiResponseSchema", () => {
  const validResponse = {
    translation: "привіт",
    partOfSpeech: "interjection",
    example: "Hello!",
    exampleTranslation: "Привіт!",
  };

  it("accepts valid response without correctedWord", () => {
    const result = GeminiResponseSchema.parse(validResponse);
    expect(result.correctedWord).toBeUndefined();
  });

  it("accepts valid response with correctedWord", () => {
    const result = GeminiResponseSchema.parse({
      ...validResponse,
      correctedWord: "hello",
    });
    expect(result.correctedWord).toBe("hello");
  });

  it("rejects response missing required field", () => {
    const { translation: _, ...incomplete } = validResponse;
    expect(() => GeminiResponseSchema.parse(incomplete)).toThrow();
  });
});

describe("TranslationSchema", () => {
  const validTranslation = {
    id: "abc-123",
    word: "hello",
    translation: "привіт",
    partOfSpeech: "interjection",
    example: "Hello!",
    exampleTranslation: "Привіт!",
    timestamp: Date.now(),
    type: "word",
  };

  it("accepts valid word-type translation", () => {
    expect(() => TranslationSchema.parse(validTranslation)).not.toThrow();
  });

  it("accepts valid text-type translation", () => {
    expect(() =>
      TranslationSchema.parse({ ...validTranslation, type: "text" }),
    ).not.toThrow();
  });

  it("rejects invalid type value", () => {
    expect(() =>
      TranslationSchema.parse({ ...validTranslation, type: "phrase" }),
    ).toThrow();
  });

  it("rejects missing required id field", () => {
    const { id: _, ...noId } = validTranslation;
    expect(() => TranslationSchema.parse(noId)).toThrow();
  });

  it("rejects missing required timestamp field", () => {
    const { timestamp: _, ...noTimestamp } = validTranslation;
    expect(() => TranslationSchema.parse(noTimestamp)).toThrow();
  });
});
