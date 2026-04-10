import { describe, it, expect } from "vitest";
import { parseAnkiTsv, parseVocabuilderJson, detectFormat, parseImportContent } from "./import";
import { Translation } from "./types";

const VOCABUILDER_ANKI_TSV = [
  "#separator:Tab",
  "#columns:Word\tTranslation\tPart of Speech\tExample\tExample Translation",
  "apple\tяблуко\tnoun\tI ate an apple.\tЯ з'їв яблуко.",
  "run\tбігти\tverb\tI run every day.\tЯ бігаю щодня.",
  "",
].join("\n");

const PLAIN_ANKI_TSV = ["apple\tяблуко", "run\tбігти", ""].join("\n");

const VOCABUILDER_JSON: Translation[] = [
  {
    id: "1",
    word: "apple",
    translation: "яблуко",
    partOfSpeech: "noun",
    example: "I ate an apple.",
    exampleTranslation: "Я з'їв яблуко.",
    timestamp: 1000,
    type: "word",
  },
  {
    id: "2",
    word: "Hello, how are you?",
    translation: "Привіт, як справи?",
    partOfSpeech: "",
    example: "",
    exampleTranslation: "",
    timestamp: 2000,
    type: "text",
  },
];

describe("parseAnkiTsv", () => {
  it("parses VocaBuilder Anki TSV format with headers", () => {
    const result = parseAnkiTsv(VOCABUILDER_ANKI_TSV);
    expect(result).toHaveLength(2);
    expect(result[0].word).toBe("apple");
    expect(result[0].translation).toBe("яблуко");
    expect(result[0].partOfSpeech).toBe("noun");
    expect(result[0].example).toBe("I ate an apple.");
    expect(result[0].exampleTranslation).toBe("Я з'їв яблуко.");
    expect(result[0].type).toBe("word");
    expect(result[1].word).toBe("run");
    expect(result[1].translation).toBe("бігти");
    expect(result[1].partOfSpeech).toBe("verb");
  });

  it("parses plain 2-column Anki TSV", () => {
    const result = parseAnkiTsv(PLAIN_ANKI_TSV);
    expect(result).toHaveLength(2);
    expect(result[0].word).toBe("apple");
    expect(result[0].translation).toBe("яблуко");
    expect(result[0].partOfSpeech).toBe("");
    expect(result[0].example).toBe("");
    expect(result[1].word).toBe("run");
    expect(result[1].translation).toBe("бігти");
  });

  it("generates unique IDs for each entry", () => {
    const result = parseAnkiTsv(VOCABUILDER_ANKI_TSV);
    const ids = result.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("skips lines with fewer than 2 columns", () => {
    const content = "apple\tяблуко\nlonely\n\nrun\tбігти\n";
    const result = parseAnkiTsv(content);
    expect(result).toHaveLength(2);
    expect(result[0].word).toBe("apple");
    expect(result[1].word).toBe("run");
  });

  it("skips lines with empty word or translation", () => {
    const content = "\tяблуко\napple\t\napple\tяблуко\n";
    const result = parseAnkiTsv(content);
    expect(result).toHaveLength(1);
    expect(result[0].word).toBe("apple");
  });

  it("returns empty array for empty content", () => {
    expect(parseAnkiTsv("")).toHaveLength(0);
    expect(parseAnkiTsv("\n\n")).toHaveLength(0);
  });

  it("handles Windows-style line endings", () => {
    const content = "apple\tяблуко\r\nrun\tбігти\r\n";
    const result = parseAnkiTsv(content);
    expect(result).toHaveLength(2);
  });

  it("trims whitespace from fields", () => {
    const content = "  apple  \t  яблуко  \n";
    const result = parseAnkiTsv(content);
    expect(result[0].word).toBe("apple");
    expect(result[0].translation).toBe("яблуко");
  });

  it("skips additional comment lines after headers", () => {
    const content = "#separator:Tab\n#columns:Word\tTranslation\n#tags column:3\napple\tяблуко\n";
    const result = parseAnkiTsv(content);
    expect(result).toHaveLength(1);
    expect(result[0].word).toBe("apple");
  });
});

describe("parseVocabuilderJson", () => {
  it("parses valid VocaBuilder JSON export", () => {
    const content = JSON.stringify(VOCABUILDER_JSON);
    const result = parseVocabuilderJson(content);
    expect(result).toHaveLength(2);
    expect(result[0].word).toBe("apple");
    expect(result[0].translation).toBe("яблуко");
    expect(result[0].partOfSpeech).toBe("noun");
    expect(result[0].type).toBe("word");
    expect(result[1].word).toBe("Hello, how are you?");
    expect(result[1].type).toBe("text");
  });

  it("generates new IDs (does not reuse originals)", () => {
    const content = JSON.stringify(VOCABUILDER_JSON);
    const result = parseVocabuilderJson(content);
    expect(result[0].id).not.toBe("1");
    expect(result[1].id).not.toBe("2");
  });

  it("skips entries with missing word or translation", () => {
    const data = [
      { word: "apple", translation: "яблуко" },
      { word: "", translation: "something" },
      { word: "run" },
      { translation: "бігти" },
    ];
    const result = parseVocabuilderJson(JSON.stringify(data));
    expect(result).toHaveLength(1);
    expect(result[0].word).toBe("apple");
  });

  it("throws on non-array JSON", () => {
    expect(() => parseVocabuilderJson('{"word": "apple"}')).toThrow("Expected a JSON array");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseVocabuilderJson("not json")).toThrow();
  });

  it("defaults missing fields gracefully", () => {
    const data = [{ word: "apple", translation: "яблуко" }];
    const result = parseVocabuilderJson(JSON.stringify(data));
    expect(result[0].partOfSpeech).toBe("");
    expect(result[0].example).toBe("");
    expect(result[0].exampleTranslation).toBe("");
    expect(result[0].type).toBe("word");
  });
});

describe("detectFormat", () => {
  it("detects JSON by filename", () => {
    expect(detectFormat("anything", "export.json")).toBe("json");
  });

  it("detects Anki by .txt filename", () => {
    expect(detectFormat("anything", "export.txt")).toBe("anki");
  });

  it("detects Anki by .tsv filename", () => {
    expect(detectFormat("anything", "export.tsv")).toBe("anki");
  });

  it("detects JSON by content starting with [", () => {
    expect(detectFormat('[{"word": "apple"}]')).toBe("json");
  });

  it("detects JSON by content starting with {", () => {
    expect(detectFormat('{"data": []}')).toBe("json");
  });

  it("defaults to Anki for tab-separated content", () => {
    expect(detectFormat("apple\tяблуко")).toBe("anki");
  });

  it("handles leading whitespace in content detection", () => {
    expect(detectFormat('  \n[{"word": "apple"}]')).toBe("json");
  });
});

describe("parseImportContent", () => {
  it("auto-detects and parses Anki TSV", () => {
    const result = parseImportContent(VOCABUILDER_ANKI_TSV, "auto", "cards.txt");
    expect(result).toHaveLength(2);
    expect(result[0].word).toBe("apple");
  });

  it("auto-detects and parses JSON", () => {
    const content = JSON.stringify(VOCABUILDER_JSON);
    const result = parseImportContent(content, "auto", "export.json");
    expect(result).toHaveLength(2);
  });

  it("respects explicit format override", () => {
    const tsvContent = "apple\tяблуко\n";
    const result = parseImportContent(tsvContent, "anki");
    expect(result).toHaveLength(1);
    expect(result[0].word).toBe("apple");
  });

  it("auto-detects by content when no filename given", () => {
    const content = JSON.stringify([{ word: "apple", translation: "яблуко" }]);
    const result = parseImportContent(content, "auto");
    expect(result).toHaveLength(1);
  });
});
