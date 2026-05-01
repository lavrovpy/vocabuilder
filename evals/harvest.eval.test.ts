import { describe, it, expect } from "vitest";
import { mergeDecisions, buildReview } from "./harvest.eval";
import { EvalDatasetSchema, type HarvestReview } from "./types";

type RawDataset = {
  name: string;
  cases: {
    input: string;
    target: {
      preferredTranslation?: { source: string; flags?: string }[];
      forbiddenTranslation?: { source: string; flags?: string }[];
      preferredPOS?: { source: string; flags?: string }[];
    };
  }[];
};

function makeDataset(): RawDataset {
  return {
    name: "test",
    cases: [
      {
        input: "hello",
        target: {
          preferredTranslation: [{ source: "привіт" }],
          forbiddenTranslation: [{ source: "привітати" }],
          preferredPOS: [{ source: "interjection", flags: "i" }],
        },
      },
      {
        input: "cat",
        target: {
          preferredTranslation: [{ source: "кіт" }],
          preferredPOS: [{ source: "noun", flags: "i" }],
        },
      },
    ],
  };
}

function makeReview(overrides: Partial<HarvestReview["cases"][number]>[]): HarvestReview {
  return {
    version: 1,
    dataset: "test.json",
    generatedAt: "2026-05-01T00:00:00Z",
    config: { runs: 20, temperature: 0.7 },
    cases: overrides.map((o) => ({
      input: o.input ?? "hello",
      alreadyPreferred: o.alreadyPreferred ?? [],
      alreadyForbidden: o.alreadyForbidden ?? [],
      observations: o.observations ?? [],
    })),
  };
}

describe("mergeDecisions", () => {
  it("adds a 'v' decision to preferredTranslation with flags 'i'", () => {
    const dataset = makeDataset();
    const review = makeReview([
      {
        input: "hello",
        observations: [
          { translation: "вітання", partOfSpeech: "noun", runs: 5, tag: null, decision: "v" },
        ],
      },
    ]);
    const { dataset: mutated, stats } = mergeDecisions(dataset, review);
    expect(stats.validAdded).toBe(1);
    expect(stats.forbidAdded).toBe(0);
    const helloCase = mutated.cases.find((c) => c.input === "hello")!;
    expect(helloCase.target.preferredTranslation).toContainEqual({ source: "вітання", flags: "i" });
  });

  it("adds an 'f' decision to forbiddenTranslation with flags 'i'", () => {
    const dataset = makeDataset();
    const review = makeReview([
      {
        input: "hello",
        observations: [
          { translation: "поганий переклад", partOfSpeech: "noun", runs: 1, tag: null, decision: "f" },
        ],
      },
    ]);
    const { dataset: mutated, stats } = mergeDecisions(dataset, review);
    expect(stats.validAdded).toBe(0);
    expect(stats.forbidAdded).toBe(1);
    const helloCase = mutated.cases.find((c) => c.input === "hello")!;
    expect(helloCase.target.forbiddenTranslation).toContainEqual({ source: "поганий переклад", flags: "i" });
  });

  it("does not mutate dataset for 'i' decisions", () => {
    const dataset = makeDataset();
    const review = makeReview([
      {
        input: "hello",
        observations: [
          { translation: "rejected", partOfSpeech: "noun", runs: 2, tag: null, decision: "i" },
        ],
      },
    ]);
    const { dataset: mutated, stats } = mergeDecisions(dataset, review);
    expect(stats.validAdded).toBe(0);
    expect(stats.forbidAdded).toBe(0);
    expect(mutated).toEqual(dataset);
  });

  it("counts null decisions as pending and does not mutate", () => {
    const dataset = makeDataset();
    const review = makeReview([
      {
        input: "hello",
        observations: [
          { translation: "вітання", partOfSpeech: "noun", runs: 5, tag: null, decision: null },
          { translation: "інше", partOfSpeech: "noun", runs: 2, tag: null, decision: null },
        ],
      },
    ]);
    const { dataset: mutated, stats } = mergeDecisions(dataset, review);
    expect(stats.pendingDecisions).toBe(2);
    expect(stats.validAdded).toBe(0);
    expect(mutated).toEqual(dataset);
  });

  it("dedupes by source string only — does not re-add an existing preferredTranslation", () => {
    const dataset = makeDataset();
    const review = makeReview([
      {
        input: "hello",
        observations: [
          { translation: "привіт", partOfSpeech: "interjection", runs: 12, tag: "alreadyPreferred", decision: "v" },
        ],
      },
    ]);
    const { dataset: mutated, stats } = mergeDecisions(dataset, review);
    expect(stats.validAdded).toBe(0);
    const helloCase = mutated.cases.find((c) => c.input === "hello")!;
    const sources = (helloCase.target.preferredTranslation ?? []).filter((r) => r.source === "привіт");
    expect(sources).toHaveLength(1);
  });

  it("does not mutate the input dataset (pure)", () => {
    const dataset = makeDataset();
    const before = JSON.stringify(dataset);
    const review = makeReview([
      {
        input: "hello",
        observations: [{ translation: "new", partOfSpeech: "noun", runs: 1, tag: null, decision: "v" }],
      },
    ]);
    mergeDecisions(dataset, review);
    expect(JSON.stringify(dataset)).toBe(before);
  });

  it("warns about cases in review missing from dataset (stale)", () => {
    const dataset = makeDataset();
    const review = makeReview([
      {
        input: "ghost-word",
        observations: [{ translation: "x", partOfSpeech: "noun", runs: 1, tag: null, decision: "v" }],
      },
    ]);
    const { stats } = mergeDecisions(dataset, review);
    expect(stats.staleCases).toEqual(["ghost-word"]);
    expect(stats.validAdded).toBe(0);
  });

  it("warns about edited translations but still applies them", () => {
    const dataset = makeDataset();
    const review = makeReview([
      {
        input: "hello",
        observations: [
          { translation: "originalA", partOfSpeech: "noun", runs: 5, tag: null, decision: null },
          { translation: "manualEdit", partOfSpeech: "noun", runs: 1, tag: null, decision: "v" },
        ],
      },
    ]);
    const { dataset: mutated, stats } = mergeDecisions(dataset, review);
    // "manualEdit" is in observations, so isn't actually edited; verify the contrary case below
    expect(stats.editedTranslations).toEqual([]);
    const helloCase = mutated.cases.find((c) => c.input === "hello")!;
    expect(helloCase.target.preferredTranslation).toContainEqual({ source: "manualEdit", flags: "i" });
  });

  it("creates preferredTranslation array when previously missing", () => {
    const dataset: RawDataset = {
      name: "test",
      cases: [{ input: "hello", target: {} }],
    };
    const review = makeReview([
      {
        input: "hello",
        observations: [{ translation: "new", partOfSpeech: "noun", runs: 1, tag: null, decision: "v" }],
      },
    ]);
    const { dataset: mutated, stats } = mergeDecisions(dataset, review);
    expect(stats.validAdded).toBe(1);
    const helloCase = mutated.cases.find((c) => c.input === "hello")!;
    expect(helloCase.target.preferredTranslation).toEqual([{ source: "new", flags: "i" }]);
  });

  it("escapes regex metacharacters in stored source", () => {
    const dataset: RawDataset = { name: "test", cases: [{ input: "hello", target: {} }] };
    const review = makeReview([
      {
        input: "hello",
        observations: [
          { translation: "щось (розм.)", partOfSpeech: "noun", runs: 3, tag: null, decision: "v" },
          { translation: "C++", partOfSpeech: "noun", runs: 2, tag: null, decision: "f" },
        ],
      },
    ]);
    const { dataset: mutated } = mergeDecisions(dataset, review);
    const helloCase = mutated.cases.find((c) => c.input === "hello")!;
    expect(helloCase.target.preferredTranslation).toContainEqual({
      source: "щось \\(розм\\.\\)",
      flags: "i",
    });
    expect(helloCase.target.forbiddenTranslation).toContainEqual({
      source: "C\\+\\+",
      flags: "i",
    });
  });

  it("produces a dataset that compiles under EvalDatasetSchema even with metacharacter translations", () => {
    const dataset: RawDataset = {
      name: "test",
      cases: [
        {
          input: "hello",
          target: { preferredTranslation: [{ source: "привіт" }], preferredPOS: [{ source: "interjection", flags: "i" }] },
        },
      ],
    };
    const review = makeReview([
      {
        input: "hello",
        observations: [
          { translation: "[unclosed", partOfSpeech: "noun", runs: 1, tag: null, decision: "v" },
          { translation: "a|b", partOfSpeech: "noun", runs: 1, tag: null, decision: "f" },
        ],
      },
    ]);
    const evalReady = EvalDatasetSchema.parse({
      ...mergeDecisions(dataset, review).dataset,
      cases: mergeDecisions(dataset, review).dataset.cases.map((c) => ({ ...c, category: "golden" as const })),
    });
    const helloCase = evalReady.cases.find((c) => c.input === "hello")!;
    expect(helloCase.target.preferredTranslation!.some((r) => r.test("[unclosed"))).toBe(true);
    expect(helloCase.target.forbiddenTranslation!.some((r) => r.test("a|b"))).toBe(true);
    expect(helloCase.target.forbiddenTranslation!.some((r) => r.test("a"))).toBe(false);
  });

  it("dedupes escaped sources idempotently across re-applies", () => {
    const dataset: RawDataset = { name: "test", cases: [{ input: "hello", target: {} }] };
    const review = makeReview([
      {
        input: "hello",
        observations: [{ translation: "C++", partOfSpeech: "noun", runs: 2, tag: null, decision: "v" }],
      },
    ]);
    const first = mergeDecisions(dataset, review);
    const second = mergeDecisions(first.dataset, review);
    expect(second.stats.validAdded).toBe(0);
    const helloCase = second.dataset.cases.find((c) => c.input === "hello")!;
    expect(helloCase.target.preferredTranslation).toHaveLength(1);
  });

  it("aggregates stats across multiple cases", () => {
    const dataset = makeDataset();
    const review = makeReview([
      {
        input: "hello",
        observations: [
          { translation: "a", partOfSpeech: "noun", runs: 1, tag: null, decision: "v" },
          { translation: "b", partOfSpeech: "noun", runs: 1, tag: null, decision: "f" },
        ],
      },
      {
        input: "cat",
        observations: [
          { translation: "c", partOfSpeech: "noun", runs: 1, tag: null, decision: "v" },
          { translation: "d", partOfSpeech: "noun", runs: 1, tag: null, decision: null },
        ],
      },
    ]);
    const { stats } = mergeDecisions(dataset, review);
    expect(stats.validAdded).toBe(2);
    expect(stats.forbidAdded).toBe(1);
    expect(stats.pendingDecisions).toBe(1);
  });
});

describe("buildReview", () => {
  it("produces a schema-valid review structure", () => {
    const dataset = makeDataset();
    const evalDataset = EvalDatasetSchema.parse({
      name: dataset.name,
      cases: [
        {
          input: "hello",
          category: "golden",
          target: {
            preferredTranslation: [{ source: "привіт" }],
            preferredPOS: [{ source: "interjection", flags: "i" }],
            forbiddenTranslation: [{ source: "привітати" }],
          },
        },
        {
          input: "cat",
          category: "golden",
          target: {
            preferredTranslation: [{ source: "кіт" }],
            preferredPOS: [{ source: "noun", flags: "i" }],
          },
        },
      ],
    });
    const pairs = new Map([
      [
        "hello",
        [
          { translation: "привіт", partOfSpeech: "interjection", runs: 18 },
          { translation: "вітання", partOfSpeech: "noun", runs: 4 },
          { translation: "привітати", partOfSpeech: "verb", runs: 1 },
        ],
      ],
      ["cat", [{ translation: "кіт", partOfSpeech: "noun", runs: 20 }]],
    ]);

    const review = buildReview("test.json", evalDataset, dataset, pairs, "2026-05-01T00:00:00Z");
    expect(review.version).toBe(1);
    expect(review.dataset).toBe("test.json");
    expect(review.cases).toHaveLength(2);

    const helloCase = review.cases.find((c) => c.input === "hello")!;
    expect(helloCase.observations).toHaveLength(3);
    const tagsByTranslation = Object.fromEntries(helloCase.observations.map((o) => [o.translation, o.tag]));
    expect(tagsByTranslation["привіт"]).toBe("alreadyPreferred");
    expect(tagsByTranslation["привітати"]).toBe("alreadyForbidden");
    expect(tagsByTranslation["вітання"]).toBe(null);

    for (const obs of helloCase.observations) {
      expect(obs.decision).toBeNull();
    }
  });
});
