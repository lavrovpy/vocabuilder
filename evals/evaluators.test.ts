import { describe, it, expect } from "vitest";
import { SCORERS, applicableScorers, scoreRun } from "./evaluators";
import type { CaseRunResult, EvalCase, EvalTarget } from "./types";
import type { GeminiWordResponse } from "../src/lib/types";

function findScorer(name: string) {
  const s = SCORERS.find((x) => x.name === name);
  if (!s) throw new Error(`Scorer ${name} not found`);
  return s;
}

function ok(output: GeminiWordResponse): CaseRunResult {
  return { kind: "ok", output };
}
function err(message: string): CaseRunResult {
  return { kind: "error", message };
}

function makeCase(input: string, target: EvalTarget, languagePair?: EvalCase["languagePair"]): EvalCase {
  return { input, category: "golden", target, languagePair };
}

describe("applicableScorers (field-presence gating)", () => {
  it("includes always-on scorers regardless of target shape", () => {
    const target: EvalTarget = {};
    const names = applicableScorers(target).map((s) => s.name);
    expect(names).toContain("schemaValid");
    expect(names).toContain("exampleUsesWord");
    expect(names).toContain("scriptCorrect");
  });

  it("excludes correctedWordEquals when correctedWord is absent", () => {
    const names = applicableScorers({}).map((s) => s.name);
    expect(names).not.toContain("correctedWordEquals");
  });

  it("includes correctedWordEquals when correctedWord is present", () => {
    const names = applicableScorers({ correctedWord: "hello" }).map((s) => s.name);
    expect(names).toContain("correctedWordEquals");
  });

  it("includes notAWordCorrect only when expectNotAWord is true", () => {
    expect(applicableScorers({}).map((s) => s.name)).not.toContain("notAWordCorrect");
    expect(applicableScorers({ expectNotAWord: false }).map((s) => s.name)).not.toContain(
      "notAWordCorrect",
    );
    expect(applicableScorers({ expectNotAWord: true }).map((s) => s.name)).toContain(
      "notAWordCorrect",
    );
  });

  it("includes hasPreferredTranslation only when preferredTranslation is non-empty", () => {
    expect(applicableScorers({ preferredTranslation: [] }).map((s) => s.name)).not.toContain(
      "hasPreferredTranslation",
    );
    expect(applicableScorers({ preferredTranslation: [/x/] }).map((s) => s.name)).toContain(
      "hasPreferredTranslation",
    );
  });

  it("includes avoidsForbiddenTranslation only when forbiddenTranslation is non-empty", () => {
    expect(applicableScorers({ forbiddenTranslation: [] }).map((s) => s.name)).not.toContain(
      "avoidsForbiddenTranslation",
    );
    expect(applicableScorers({ forbiddenTranslation: [/x/] }).map((s) => s.name)).toContain(
      "avoidsForbiddenTranslation",
    );
  });

  it("includes sensesCoverPreferred only when preferredTranslationsCover is set", () => {
    expect(applicableScorers({}).map((s) => s.name)).not.toContain("sensesCoverPreferred");
    expect(
      applicableScorers({
        preferredTranslationsCover: { regexes: [/x/], threshold: 0.5 },
      }).map((s) => s.name),
    ).toContain("sensesCoverPreferred");
  });
});

describe("schemaValid", () => {
  const scorer = findScorer("schemaValid");
  const c = makeCase("hello", {});
  it("returns 1 on ok", () => {
    expect(scorer.score(ok({ senses: [] }), c)).toBe(1);
  });
  it("returns 0 on error", () => {
    expect(scorer.score(err("GEMINI_INVALID_RESPONSE"), c)).toBe(0);
  });
});

describe("exampleUsesWord", () => {
  const scorer = findScorer("exampleUsesWord");

  it("returns 1 when every sense's example contains the word", () => {
    const c = makeCase("cat", {});
    const out: GeminiWordResponse = {
      senses: [
        { translation: "кіт", partOfSpeech: "noun", example: "Кіт.", exampleTranslation: "I see a cat." },
        { translation: "кішка", partOfSpeech: "noun", example: "Кішка.", exampleTranslation: "The cat is here." },
      ],
    };
    expect(scorer.score(ok(out), c)).toBe(1);
  });

  it("returns a fraction when only some examples contain the word", () => {
    const c = makeCase("cat", {});
    const out: GeminiWordResponse = {
      senses: [
        { translation: "кіт", partOfSpeech: "noun", example: "Кіт.", exampleTranslation: "I see a cat." },
        { translation: "тварина", partOfSpeech: "noun", example: "Тварина.", exampleTranslation: "The animal is here." },
      ],
    };
    expect(scorer.score(ok(out), c)).toBe(0.5);
  });

  it("uses correctedWord when present (typo path)", () => {
    const c = makeCase("ket", { correctedWord: "cat" });
    const out: GeminiWordResponse = {
      correctedWord: "cat",
      senses: [
        { translation: "кіт", partOfSpeech: "noun", example: "Кіт.", exampleTranslation: "I see a cat." },
      ],
    };
    expect(scorer.score(ok(out), c)).toBe(1);
  });

  it("returns 1 when notAWord is true (no senses to check)", () => {
    const c = makeCase("xqfjvbn", {});
    expect(scorer.score(ok({ senses: [], notAWord: true }), c)).toBe(1);
  });

  it("returns 0 on error", () => {
    expect(scorer.score(err("anything"), makeCase("hi", {}))).toBe(0);
  });
});

describe("scriptCorrect", () => {
  const scorer = findScorer("scriptCorrect");

  it("returns 1 when all translations are in the target script (en→uk → Cyrillic)", () => {
    const c = makeCase("cat", {});
    const out: GeminiWordResponse = {
      senses: [
        { translation: "кіт", partOfSpeech: "noun", example: "Кіт.", exampleTranslation: "cat" },
        { translation: "кішка", partOfSpeech: "noun", example: "Кішка.", exampleTranslation: "cat" },
      ],
    };
    expect(scorer.score(ok(out), c)).toBe(1);
  });

  it("returns 0 when a translation is in the wrong script (Latin instead of Cyrillic)", () => {
    const c = makeCase("cat", {});
    const out: GeminiWordResponse = {
      senses: [
        { translation: "kit", partOfSpeech: "noun", example: "Kit.", exampleTranslation: "cat" },
      ],
    };
    expect(scorer.score(ok(out), c)).toBe(0);
  });

  it("returns 1 for uk→en when translation is Latin", () => {
    const c = makeCase("кіт", {}, {
      source: { code: "uk", name: "Ukrainian" },
      target: { code: "en", name: "English" },
    });
    const out: GeminiWordResponse = {
      senses: [
        { translation: "cat", partOfSpeech: "noun", example: "I see a cat.", exampleTranslation: "Я бачу кота." },
      ],
    };
    expect(scorer.score(ok(out), c)).toBe(1);
  });

  it("returns 1 for notAWord without any senses", () => {
    expect(scorer.score(ok({ senses: [], notAWord: true }), makeCase("xqfjvbn", {}))).toBe(1);
  });
});

describe("correctedWordEquals", () => {
  const scorer = findScorer("correctedWordEquals");

  it("returns 1 when output.correctedWord matches", () => {
    const c = makeCase("red hering", { correctedWord: "red herring" });
    const out: GeminiWordResponse = {
      correctedWord: "red herring",
      senses: [{ translation: "оманка", partOfSpeech: "idiom", example: "x", exampleTranslation: "y" }],
    };
    expect(scorer.score(ok(out), c)).toBe(1);
  });

  it("returns 0 when correction is missing", () => {
    const c = makeCase("red hering", { correctedWord: "red herring" });
    const out: GeminiWordResponse = {
      senses: [{ translation: "оманка", partOfSpeech: "idiom", example: "x", exampleTranslation: "y" }],
    };
    expect(scorer.score(ok(out), c)).toBe(0);
  });

  it("returns 0 when correction differs", () => {
    const c = makeCase("red hering", { correctedWord: "red herring" });
    const out: GeminiWordResponse = {
      correctedWord: "red herrings",
      senses: [{ translation: "оманка", partOfSpeech: "idiom", example: "x", exampleTranslation: "y" }],
    };
    expect(scorer.score(ok(out), c)).toBe(0);
  });
});

describe("avoidsForbiddenTranslation", () => {
  const scorer = findScorer("avoidsForbiddenTranslation");

  it("returns 1 when no forbidden regex matches any sense", () => {
    const c = makeCase("red herring", { forbiddenTranslation: [/червоний оселедець/] });
    const out: GeminiWordResponse = {
      senses: [
        { translation: "оманка", partOfSpeech: "idiom", example: "x", exampleTranslation: "y" },
      ],
    };
    expect(scorer.score(ok(out), c)).toBe(1);
  });

  it("returns 0 when a forbidden regex matches any sense", () => {
    const c = makeCase("red herring", { forbiddenTranslation: [/червоний оселедець/] });
    const out: GeminiWordResponse = {
      senses: [
        { translation: "червоний оселедець", partOfSpeech: "idiom", example: "x", exampleTranslation: "y" },
      ],
    };
    expect(scorer.score(ok(out), c)).toBe(0);
  });

  it("returns 0 if any of multiple senses violates", () => {
    const c = makeCase("red herring", { forbiddenTranslation: [/червоний оселедець/] });
    const out: GeminiWordResponse = {
      senses: [
        { translation: "оманка", partOfSpeech: "idiom", example: "x", exampleTranslation: "y" },
        { translation: "червоний оселедець", partOfSpeech: "noun", example: "x", exampleTranslation: "y" },
      ],
    };
    expect(scorer.score(ok(out), c)).toBe(0);
  });
});

describe("notAWordCorrect", () => {
  const scorer = findScorer("notAWordCorrect");

  it("returns 1 when output.notAWord === true", () => {
    const c = makeCase("xqfjvbn", { expectNotAWord: true });
    expect(scorer.score(ok({ senses: [], notAWord: true }), c)).toBe(1);
  });

  it("returns 0 when notAWord is false/undefined", () => {
    const c = makeCase("hello", { expectNotAWord: true });
    expect(scorer.score(ok({ senses: [{ translation: "x", partOfSpeech: "noun", example: "x", exampleTranslation: "y" }] }), c)).toBe(0);
  });

  it("returns 0 on transport error", () => {
    expect(scorer.score(err("NETWORK_OFFLINE"), makeCase("xqfjvbn", { expectNotAWord: true }))).toBe(0);
  });
});

describe("hasPreferredTranslation (soft)", () => {
  const scorer = findScorer("hasPreferredTranslation");

  it("returns 1 when ANY regex matches ANY sense translation", () => {
    const c = makeCase("hello", { preferredTranslation: [/привіт/, /вітаю/] });
    const out: GeminiWordResponse = {
      senses: [
        { translation: "доброго дня", partOfSpeech: "phrase", example: "x", exampleTranslation: "y" },
        { translation: "привіт усім", partOfSpeech: "phrase", example: "x", exampleTranslation: "y" },
      ],
    };
    expect(scorer.score(ok(out), c)).toBe(1);
  });

  it("returns 0 when no regex matches any sense (drift signal)", () => {
    const c = makeCase("hello", { preferredTranslation: [/привіт/] });
    const out: GeminiWordResponse = {
      senses: [
        { translation: "доброго дня", partOfSpeech: "phrase", example: "x", exampleTranslation: "y" },
      ],
    };
    expect(scorer.score(ok(out), c)).toBe(0);
  });
});

describe("hasPreferredPOS (soft)", () => {
  const scorer = findScorer("hasPreferredPOS");

  it("returns 1 when ANY regex matches ANY POS", () => {
    const c = makeCase("hello", { preferredPOS: [/interjection/i, /phrase/i] });
    const out: GeminiWordResponse = {
      senses: [
        { translation: "x", partOfSpeech: "noun", example: "x", exampleTranslation: "y" },
        { translation: "x", partOfSpeech: "phrase", example: "x", exampleTranslation: "y" },
      ],
    };
    expect(scorer.score(ok(out), c)).toBe(1);
  });

  it("returns 0 when no POS matches", () => {
    const c = makeCase("hello", { preferredPOS: [/interjection/i] });
    const out: GeminiWordResponse = {
      senses: [
        { translation: "x", partOfSpeech: "noun", example: "x", exampleTranslation: "y" },
      ],
    };
    expect(scorer.score(ok(out), c)).toBe(0);
  });
});

describe("sensesCoverPreferred (soft)", () => {
  const scorer = findScorer("sensesCoverPreferred");

  it("returns the fraction of preferred regexes each matched by ≥1 sense", () => {
    const c = makeCase("book", {
      preferredTranslationsCover: { regexes: [/книга/, /книжка/, /бронювати/], threshold: 0.5 },
    });
    const out: GeminiWordResponse = {
      senses: [
        { translation: "книга", partOfSpeech: "noun", example: "x", exampleTranslation: "y" },
        { translation: "книжка", partOfSpeech: "noun", example: "x", exampleTranslation: "y" },
      ],
    };
    expect(scorer.score(ok(out), c)).toBeCloseTo(2 / 3, 6);
  });

  it("returns 0 when senses are empty", () => {
    const c = makeCase("book", {
      preferredTranslationsCover: { regexes: [/книга/], threshold: 0.5 },
    });
    expect(scorer.score(ok({ senses: [] }), c)).toBe(0);
  });
});

describe("scoreRun integration", () => {
  it("runs only applicable scorers and skips inapplicable ones", () => {
    const c = makeCase("hello", {
      preferredTranslation: [/привіт/],
    });
    const out: GeminiWordResponse = {
      senses: [
        { translation: "привіт", partOfSpeech: "interjection", example: "Привіт!", exampleTranslation: "Hello!" },
      ],
    };
    const scores = scoreRun(ok(out), c);
    const names = scores.map((s) => s.scorer);
    expect(names).toContain("schemaValid");
    expect(names).toContain("exampleUsesWord");
    expect(names).toContain("scriptCorrect");
    expect(names).toContain("hasPreferredTranslation");
    expect(names).not.toContain("correctedWordEquals");
    expect(names).not.toContain("avoidsForbiddenTranslation");
    expect(names).not.toContain("notAWordCorrect");
  });
});
