import { z } from "zod";
import type { LanguagePair } from "../src/lib/languages";

const RegexLiteralSchema = z
  .object({
    source: z.string().min(1),
    flags: z.string().optional(),
  })
  .transform(({ source, flags }) => new RegExp(source, flags));

const LanguageSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
});

const LanguagePairSchema = z.object({
  source: LanguageSchema,
  target: LanguageSchema,
});

export const EvalTargetSchema = z
  .object({
    preferredTranslation: z.array(RegexLiteralSchema).optional(),
    preferredPOS: z.array(RegexLiteralSchema).optional(),
    preferredTranslationsCover: z
      .object({
        regexes: z.array(RegexLiteralSchema).min(1),
      })
      .optional(),
    correctedWord: z.string().min(1).optional(),
    forbiddenTranslation: z.array(RegexLiteralSchema).optional(),
    expectNotAWord: z.boolean().optional(),
  })
  .strict();

export const EvalCaseCategorySchema = z.enum(["golden", "secondary", "negative"]);

export const EvalCaseSchema = z
  .object({
    input: z.string().min(1),
    category: EvalCaseCategorySchema,
    languagePair: LanguagePairSchema.optional(),
    notes: z.string().optional(),
    target: EvalTargetSchema,
  })
  .strict();

export const EvalDatasetSchema = z.object({
  name: z.string().min(1),
  cases: z.array(EvalCaseSchema).min(1),
});

export type EvalTarget = z.infer<typeof EvalTargetSchema>;
export type EvalCaseCategory = z.infer<typeof EvalCaseCategorySchema>;
export type EvalCase = z.infer<typeof EvalCaseSchema> & { languagePair?: LanguagePair };
export type EvalDataset = z.infer<typeof EvalDatasetSchema>;

const RegexLiteralRawSchema = z
  .object({
    source: z.string().min(1),
    flags: z.string().optional(),
  })
  .strict();

export const HarvestDecisionSchema = z.union([z.literal("v"), z.literal("i"), z.literal("f"), z.null()]);

export const HarvestTagSchema = z.union([z.literal("alreadyPreferred"), z.literal("alreadyForbidden"), z.null()]);

export const HarvestReviewObservationSchema = z
  .object({
    translation: z.string().min(1),
    partOfSpeech: z.string().min(1),
    runs: z.number().int().nonnegative(),
    tag: HarvestTagSchema,
    decision: HarvestDecisionSchema,
  })
  .strict();

export const HarvestReviewCaseSchema = z
  .object({
    input: z.string().min(1),
    alreadyPreferred: z.array(RegexLiteralRawSchema),
    alreadyForbidden: z.array(RegexLiteralRawSchema),
    observations: z.array(HarvestReviewObservationSchema),
  })
  .strict();

export const HarvestReviewSchema = z
  .object({
    version: z.literal(1),
    dataset: z.string().min(1),
    generatedAt: z.string().min(1),
    config: z
      .object({
        runs: z.number().int().positive(),
        temperature: z.number(),
      })
      .strict(),
    cases: z.array(HarvestReviewCaseSchema),
  })
  .strict();

export type HarvestDecision = z.infer<typeof HarvestDecisionSchema>;
export type HarvestTag = z.infer<typeof HarvestTagSchema>;
export type HarvestReviewObservation = z.infer<typeof HarvestReviewObservationSchema>;
export type HarvestReviewCase = z.infer<typeof HarvestReviewCaseSchema>;
export type HarvestReview = z.infer<typeof HarvestReviewSchema>;

export type CaseRunResult =
  | { kind: "ok"; output: import("../src/lib/types").GeminiWordResponse }
  | { kind: "error"; message: string; cause?: unknown };

export type ScorerTier = "hard" | "soft";

export type ScorerScore = {
  scorer: string;
  tier: ScorerTier;
  score: number;
  applicable: boolean;
};

export type CaseReport = {
  input: string;
  dataset: string;
  category: EvalCaseCategory;
  passed: boolean;
  scorerScores: {
    hard: Record<string, number>;
    soft: Record<string, number>;
  };
  runs: { outputOrError: unknown }[];
};

export type DriftEntry = {
  input: string;
  softScorer: string;
  score: number;
};

export type AggregateReport = {
  startedAt: string;
  durationMs: number;
  suite: "smoke" | "full";
  languagePair: { source: string; target: string };
  cases: CaseReport[];
  passRate: number;
  threshold: number;
  passed: boolean;
  drift: {
    casesWithSoftMisses: number;
    perCase: DriftEntry[];
  };
};
