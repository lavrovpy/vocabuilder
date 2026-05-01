import { describe, it, expect } from "vitest";
import { HarvestReviewSchema } from "./types";

function makeValidReview() {
  return {
    version: 1,
    dataset: "baseline.json",
    generatedAt: "2026-05-01T13:22:10Z",
    config: { runs: 20, temperature: 0.7 },
    cases: [
      {
        input: "red herring",
        alreadyPreferred: [{ source: "оманлив" }, { source: "хибн", flags: "i" }],
        alreadyForbidden: [{ source: "червоний оселедець" }],
        observations: [
          {
            translation: "оманливий хід",
            partOfSpeech: "noun",
            runs: 12,
            tag: null,
            decision: null,
          },
          {
            translation: "червоний оселедець",
            partOfSpeech: "idiom",
            runs: 1,
            tag: "alreadyForbidden",
            decision: "i",
          },
        ],
      },
    ],
  };
}

describe("HarvestReviewSchema", () => {
  it("round-trips a valid review file", () => {
    const review = makeValidReview();
    const parsed = HarvestReviewSchema.parse(review);
    const serialized = JSON.stringify(parsed);
    const reparsed = HarvestReviewSchema.parse(JSON.parse(serialized));
    expect(reparsed).toEqual(parsed);
  });

  it("accepts null decisions", () => {
    const review = makeValidReview();
    review.cases[0].observations[0].decision = null;
    expect(HarvestReviewSchema.safeParse(review).success).toBe(true);
  });

  it("accepts empty observations array", () => {
    const review = makeValidReview();
    review.cases[0].observations = [];
    expect(HarvestReviewSchema.safeParse(review).success).toBe(true);
  });

  it("accepts all decision codes v / i / f / null", () => {
    for (const code of ["v", "i", "f", null] as const) {
      const review = makeValidReview();
      review.cases[0].observations[0].decision = code;
      const result = HarvestReviewSchema.safeParse(review);
      if (!result.success) {
        throw new Error(`decision=${String(code)} failed: ${JSON.stringify(result.error.issues)}`);
      }
    }
  });

  it("rejects typo'd decision values", () => {
    for (const bad of ["valid", "V", "yes", "VALID", "f ", ""]) {
      const review = makeValidReview();
      (review.cases[0].observations[0] as { decision: unknown }).decision = bad;
      expect(HarvestReviewSchema.safeParse(review).success).toBe(false);
    }
  });

  it("rejects unknown top-level keys (strict)", () => {
    const review = makeValidReview() as Record<string, unknown>;
    review.extraField = "nope";
    expect(HarvestReviewSchema.safeParse(review).success).toBe(false);
  });

  it("rejects unknown observation keys (strict)", () => {
    const review = makeValidReview();
    (review.cases[0].observations[0] as Record<string, unknown>).note = "nope";
    expect(HarvestReviewSchema.safeParse(review).success).toBe(false);
  });

  it("rejects version: 2", () => {
    const review = makeValidReview() as Record<string, unknown>;
    review.version = 2;
    expect(HarvestReviewSchema.safeParse(review).success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const review = makeValidReview() as Record<string, unknown>;
    delete review.generatedAt;
    expect(HarvestReviewSchema.safeParse(review).success).toBe(false);
  });

  it("rejects bad tag values", () => {
    const review = makeValidReview();
    (review.cases[0].observations[0] as { tag: unknown }).tag = "preferred";
    expect(HarvestReviewSchema.safeParse(review).success).toBe(false);
  });

  it("rejects negative runs", () => {
    const review = makeValidReview();
    review.cases[0].observations[0].runs = -1;
    expect(HarvestReviewSchema.safeParse(review).success).toBe(false);
  });
});
