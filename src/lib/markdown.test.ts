import { describe, it, expect } from "vitest";
import {
  buildFlashcardDetailMarkdown,
  buildTranslationDetailMarkdown,
  buildTextTranslationDetailMarkdown,
  TTS_HINT_TEXT,
  withTtsHint,
} from "./markdown";

describe("buildTranslationDetailMarkdown", () => {
  const translation = {
    word: "hello",
    translation: "привіт",
    partOfSpeech: "interjection",
    example: "Привіт, як справи?",
    exampleTranslation: "Hello, how are you?",
  };

  it("shows the source-language sentence before the target-language one", () => {
    const md = buildTranslationDetailMarkdown(translation);
    expect(md).toContain("**Hello**, how are you?");
    expect(md.indexOf("**Hello**, how are you?")).toBeLessThan(md.indexOf("Привіт, як справи?"));
    expect(md).toContain("*Привіт, як справи?*");
  });

  it("bolds the looked-up word only in the source-language sentence", () => {
    const md = buildTranslationDetailMarkdown({
      ...translation,
      word: "state",
      example: "Викладіть свою позицію. State.",
      exampleTranslation: "Please state your position.",
    });
    expect(md).toContain("Please **state** your position\\.");
    expect(md).toContain("*Викладіть свою позицію\\. State\\.*");
  });

  it("matches the exact form case-insensitively and leaves longer tokens alone", () => {
    const md = buildTranslationDetailMarkdown({
      ...translation,
      word: "кіт",
      exampleTranslation: "Кіт спить, а кітч ні.",
    });
    expect(md).toContain("**Кіт** спить, а кітч ні\\.");
  });

  it("falls back to an inflected form when the exact word is absent", () => {
    const md = buildTranslationDetailMarkdown({
      ...translation,
      word: "cat",
      exampleTranslation: "Two cats sat on the mat.",
    });
    expect(md).toContain("Two **cats** sat on the mat\\.");
  });

  it("falls back to a substring match for scripts without word boundaries", () => {
    const md = buildTranslationDetailMarkdown({
      ...translation,
      word: "猫",
      exampleTranslation: "我喜欢猫。",
    });
    expect(md).toContain("我喜欢**猫**。");
  });

  it("bolds multi-word lookups and words containing regex metacharacters", () => {
    const phrase = buildTranslationDetailMarkdown({
      ...translation,
      word: "give up",
      exampleTranslation: "Never give up!",
    });
    expect(phrase).toContain("Never **give up**\\!");

    const symbols = buildTranslationDetailMarkdown({
      ...translation,
      word: "c++",
      exampleTranslation: "I write c++ daily.",
    });
    expect(symbols).toContain("I write **c\\+\\+** daily\\.");
  });

  it("leaves the sentence untouched when the word does not occur in it", () => {
    const md = buildTranslationDetailMarkdown({
      ...translation,
      word: "hello",
      exampleTranslation: "Good morning, everyone.",
    });
    expect(md).toContain("Good morning, everyone\\.");
    expect(md).not.toContain("**Good");
  });

  it("renders basic translation without correction note", () => {
    const md = buildTranslationDetailMarkdown(translation);
    expect(md).toContain("## hello");
    expect(md).toContain("**привіт**");
    expect(md).toContain("*(interjection)*");
    expect(md).not.toContain("Corrected from");
  });

  it("shows correction note when input differs from word", () => {
    const md = buildTranslationDetailMarkdown(translation, "helo");
    expect(md).toContain('Corrected from "helo"');
  });

  it("does not show correction note when input matches word", () => {
    const md = buildTranslationDetailMarkdown(translation, "hello");
    expect(md).not.toContain("Corrected from");
  });

  it("escapes markdown special characters in word", () => {
    const t = { ...translation, word: "test|word*bold_under" };
    const md = buildTranslationDetailMarkdown(t);
    expect(md).toContain("\\|");
    expect(md).toContain("\\*");
    expect(md).toContain("\\_");
  });

  it("escapes HTML entities in translation", () => {
    const t = { ...translation, translation: "a < b & c > d" };
    const md = buildTranslationDetailMarkdown(t);
    expect(md).toContain("&lt;");
    expect(md).toContain("&gt;");
  });

  it("handles multiline example with line breaks", () => {
    const t = { ...translation, example: "Line one\nLine two" };
    const md = buildTranslationDetailMarkdown(t);
    // multiline escaping joins with markdown line break
    expect(md).toContain("  \n");
  });
});

describe("buildFlashcardDetailMarkdown", () => {
  it("shows the source-language sentence before the target-language one", () => {
    const md = buildFlashcardDetailMarkdown({
      word: "hello",
      translation: "привіт",
      partOfSpeech: "interjection",
      example: "Привіт, як справи?",
      exampleTranslation: "Hello, how are you?",
    });
    expect(md).toContain("**Hello**, how are you?");
    expect(md.indexOf("**Hello**, how are you?")).toBeLessThan(md.indexOf("Привіт, як справи?"));
    expect(md).toContain("*Привіт, як справи?*");
  });
});

describe("buildTextTranslationDetailMarkdown", () => {
  it("renders translation and original sections", () => {
    const md = buildTextTranslationDetailMarkdown("Hello world", "Привіт світ");
    expect(md).toContain("## Translation");
    expect(md).toContain("## Original");
    expect(md).toContain("Hello world");
    expect(md).toContain("Привіт світ");
  });

  it("escapes special chars in both sections", () => {
    const md = buildTextTranslationDetailMarkdown("a|b", "c*d");
    expect(md).toContain("a\\|b");
    expect(md).toContain("c\\*d");
  });
});

describe("withTtsHint", () => {
  it("appends the hint after the content, separated by a rule", () => {
    const md = withTtsHint("## word\n\n*Довге речення*");
    expect(md.startsWith("## word\n\n*Довге речення*")).toBe(true);
    expect(md.indexOf("---")).toBeGreaterThan(md.indexOf("*Довге речення*"));
    expect(md.trimEnd().endsWith(`${TTS_HINT_TEXT}*`)).toBe(true);
  });
});
