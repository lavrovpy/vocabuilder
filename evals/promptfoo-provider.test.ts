import { describe, expect, it } from "vitest";
import VocabuilderTranslateWordProvider from "./promptfoo/provider";

describe("VocabuilderTranslateWordProvider language pair validation", () => {
  // Silent en/uk defaults would mask config bugs by running an eval against the
  // wrong language pair and reporting a false pass. The provider must fail loud
  // when a test case forgets to declare its language pair.
  it("throws when language code vars are missing", async () => {
    const provider = new VocabuilderTranslateWordProvider();
    await expect(provider.callApi("hello", { vars: { input: "hello" } })).rejects.toThrow(
      /sourceLanguageCode/,
    );
  });

  it("throws when language name vars are missing even if codes are set", async () => {
    const provider = new VocabuilderTranslateWordProvider();
    await expect(
      provider.callApi("hello", {
        vars: {
          input: "hello",
          sourceLanguageCode: "en",
          targetLanguageCode: "uk",
        },
      }),
    ).rejects.toThrow(/sourceLanguageName/);
  });
});
