import type { GeminiWordResponse } from "../src/lib/types";
import { exampleContainsWord } from "../src/lib/gemini";
import type { CaseRunResult, EvalCase, EvalTarget, ScorerScore, ScorerTier } from "./types";

type Scorer = {
  name: string;
  tier: ScorerTier;
  applies: (target: EvalTarget) => boolean;
  score: (run: CaseRunResult, c: EvalCase) => number;
};

const TARGET_SCRIPT_BY_LANG: Record<string, "Latin" | "Cyrillic"> = {
  en: "Latin",
  de: "Latin",
  fr: "Latin",
  es: "Latin",
  it: "Latin",
  pt: "Latin",
  nl: "Latin",
  cs: "Latin",
  sv: "Latin",
  pl: "Latin",
  tr: "Latin",
  uk: "Cyrillic",
  ru: "Cyrillic",
  be: "Cyrillic",
};

function targetScriptFor(lang: string): "Latin" | "Cyrillic" | null {
  return TARGET_SCRIPT_BY_LANG[lang] ?? null;
}

function isInScript(s: string, script: "Latin" | "Cyrillic"): boolean {
  const expected = new RegExp(`^[\\p{Script=${script}}\\p{N}\\p{P}\\p{Z}\\p{M}\\p{S}]+$`, "u");
  const hasLetter = /\p{L}/u.test(s);
  return hasLetter && expected.test(s);
}

function effectiveWord(c: EvalCase, output: GeminiWordResponse): string {
  return output.correctedWord ?? c.input;
}

function fraction(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function targetLangCode(c: EvalCase): string {
  return c.languagePair?.target.code ?? "uk";
}

const SCHEMA_VALID: Scorer = {
  name: "schemaValid",
  tier: "hard",
  applies: () => true,
  score: (run) => (run.kind === "ok" ? 1 : 0),
};

const EXAMPLE_USES_WORD: Scorer = {
  name: "exampleUsesWord",
  tier: "hard",
  applies: () => true,
  score: (run, c) => {
    if (run.kind !== "ok") return 0;
    if (run.output.notAWord) return 1;
    const senses = run.output.senses;
    if (senses.length === 0) return 0;
    const word = effectiveWord(c, run.output);
    const hits = senses.filter((s) => exampleContainsWord(s.exampleTranslation, word)).length;
    return fraction(hits, senses.length);
  },
};

const SCRIPT_CORRECT: Scorer = {
  name: "scriptCorrect",
  tier: "hard",
  applies: () => true,
  score: (run, c) => {
    if (run.kind !== "ok") return 0;
    if (run.output.notAWord) return 1;
    const senses = run.output.senses;
    if (senses.length === 0) return 0;
    const script = targetScriptFor(targetLangCode(c));
    if (!script) return 1;
    const hits = senses.filter((s) => isInScript(s.translation, script)).length;
    return fraction(hits, senses.length);
  },
};

const CORRECTED_WORD_EQUALS: Scorer = {
  name: "correctedWordEquals",
  tier: "hard",
  applies: (t) => t.correctedWord !== undefined,
  score: (run, c) => {
    if (run.kind !== "ok") return 0;
    return run.output.correctedWord === c.target.correctedWord ? 1 : 0;
  },
};

const AVOIDS_FORBIDDEN_TRANSLATION: Scorer = {
  name: "avoidsForbiddenTranslation",
  tier: "hard",
  applies: (t) => Array.isArray(t.forbiddenTranslation) && t.forbiddenTranslation.length > 0,
  score: (run, c) => {
    if (run.kind !== "ok") return 0;
    const forbidden = c.target.forbiddenTranslation ?? [];
    const senses = run.output.senses;
    for (const sense of senses) {
      if (forbidden.some((re) => re.test(sense.translation))) return 0;
    }
    return 1;
  },
};

const NOT_A_WORD_CORRECT: Scorer = {
  name: "notAWordCorrect",
  tier: "hard",
  applies: (t) => t.expectNotAWord === true,
  score: (run) => {
    if (run.kind !== "ok") return 0;
    return run.output.notAWord === true ? 1 : 0;
  },
};

const HAS_PREFERRED_TRANSLATION: Scorer = {
  name: "hasPreferredTranslation",
  tier: "soft",
  applies: (t) => Array.isArray(t.preferredTranslation) && t.preferredTranslation.length > 0,
  score: (run, c) => {
    if (run.kind !== "ok") return 0;
    const preferred = c.target.preferredTranslation ?? [];
    const senses = run.output.senses;
    for (const sense of senses) {
      if (preferred.some((re) => re.test(sense.translation))) return 1;
    }
    return 0;
  },
};

const HAS_PREFERRED_POS: Scorer = {
  name: "hasPreferredPOS",
  tier: "soft",
  applies: (t) => Array.isArray(t.preferredPOS) && t.preferredPOS.length > 0,
  score: (run, c) => {
    if (run.kind !== "ok") return 0;
    const preferred = c.target.preferredPOS ?? [];
    const senses = run.output.senses;
    for (const sense of senses) {
      if (preferred.some((re) => re.test(sense.partOfSpeech))) return 1;
    }
    return 0;
  },
};

const SENSES_COVER_PREFERRED: Scorer = {
  name: "sensesCoverPreferred",
  tier: "soft",
  applies: (t) => t.preferredTranslationsCover !== undefined,
  score: (run, c) => {
    if (run.kind !== "ok") return 0;
    const cover = c.target.preferredTranslationsCover;
    if (!cover) return 0;
    const senses = run.output.senses;
    if (senses.length === 0) return 0;
    const matched = cover.regexes.filter((re) => senses.some((s) => re.test(s.translation))).length;
    return fraction(matched, cover.regexes.length);
  },
};

export const SCORERS: Scorer[] = [
  SCHEMA_VALID,
  EXAMPLE_USES_WORD,
  SCRIPT_CORRECT,
  CORRECTED_WORD_EQUALS,
  AVOIDS_FORBIDDEN_TRANSLATION,
  NOT_A_WORD_CORRECT,
  HAS_PREFERRED_TRANSLATION,
  HAS_PREFERRED_POS,
  SENSES_COVER_PREFERRED,
];

export const HARD_SCORER_THRESHOLD = 1.0;

export function applicableScorers(target: EvalTarget): Scorer[] {
  return SCORERS.filter((s) => s.applies(target));
}

export function scoreRun(run: CaseRunResult, c: EvalCase): ScorerScore[] {
  return applicableScorers(c.target).map((s) => ({
    scorer: s.name,
    tier: s.tier,
    score: s.score(run, c),
    applicable: true,
  }));
}

export type { Scorer };
