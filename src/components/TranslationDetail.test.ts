import { describe, expect, it } from "vitest";
import { buildDetailMarkdown } from "./TranslationDetail";
import type { Translation } from "../lib/types";

const wordItem: Translation = {
  id: "w1",
  word: "conjecture",
  translation: "припущення",
  partOfSpeech: "noun",
  example: "His conclusions were mere conjecture.",
  exampleTranslation: "Його висновки були лише припущеннями.",
  timestamp: 1,
  type: "word",
};

const textItem: Translation = {
  id: "t1",
  word: "Hello world",
  translation: "Привіт світ",
  partOfSpeech: "",
  example: "",
  exampleTranslation: "",
  timestamp: 1,
  type: "text",
};

describe("buildDetailMarkdown", () => {
  it("routes word items through the structured word builder", () => {
    const md = buildDetailMarkdown(wordItem);
    // Word builder leads with the gloss and quotes the entry line; text builder does not.
    expect(md.split("\n")[0]).toBe("# припущення");
    expect(md).toContain("\n> **conjecture** · noun\n");
  });

  it("carries the dictionary fields of a stored translation into the entry line", () => {
    const md = buildDetailMarkdown({
      ...wordItem,
      transcription: "kənˈdʒektʃə(r)",
      forms: "pl. conjectures",
      register: "formal",
    });
    expect(md).toContain("\n> **conjecture** /kənˈdʒektʃə\\(r\\)/ · noun · pl\\. conjectures · *formal*\n");
  });

  it("forwards originalInput so corrections surface", () => {
    const md = buildDetailMarkdown(wordItem, "conjectur");
    expect(md).toContain('Corrected from "conjectur"');
  });

  it("omits the correction note when originalInput matches", () => {
    const md = buildDetailMarkdown(wordItem, "conjecture");
    expect(md).not.toContain("Corrected from");
  });

  it("ends on the example sentences, leaving the rest to the metadata rail", () => {
    const md = buildDetailMarkdown(wordItem);
    expect(md.indexOf("His conclusions were mere")).toBeGreaterThan(md.indexOf("Його висновки"));
    expect(md.trimEnd().endsWith("*")).toBe(true);
    expect(md).not.toContain("noun");
  });

  // The chords are only rendered from SHORTCUTS, in the metadata rail. A modifier
  // glyph reappearing in the markdown means a hardcoded hint has crept back in.
  it("never spells a keyboard chord into the markdown", () => {
    for (const md of [buildDetailMarkdown(wordItem), buildDetailMarkdown(textItem)]) {
      expect(md).not.toMatch(/[⌘⌥⇧⌃]/u);
    }
  });

  it("routes text items through the text builder", () => {
    const md = buildDetailMarkdown(textItem);
    expect(md).toContain("## Translation");
    expect(md).toContain("## Original");
    expect(md).not.toContain("# Hello world");
  });
});
