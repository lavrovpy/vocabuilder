import { describe, expect, it } from "vitest";
import { normalizeGeminiModelId } from "./geminiModel";

describe("normalizeGeminiModelId", () => {
  it("trims custom model IDs and removes the optional Google models/ prefix", () => {
    expect(normalizeGeminiModelId(" models/gemini-3.5-flash ")).toBe("gemini-3.5-flash");
    expect(normalizeGeminiModelId(" custom-model ")).toBe("custom-model");
  });
});
