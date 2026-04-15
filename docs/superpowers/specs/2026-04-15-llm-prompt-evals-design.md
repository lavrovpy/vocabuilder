# LLM Prompt Evaluation Harness — Design

**Date:** 2026-04-15
**Status:** Draft for review
**Scope:** Vocabuilder Raycast extension — `translateWord` prompt in `src/lib/gemini.ts`

## 1. Problem

The Vocabuilder extension depends on a non-trivial Gemini prompt in `src/lib/gemini.ts` that handles many cases at once: single words, phrasal verbs, idioms, typo correction, red-herring rejection, idiomatic-vs-literal routing, structured JSON with multiple senses, POS labels, and example sentences.

When this prompt is edited, LLM non-determinism makes it impossible to tell by eye whether the change improves quality, preserves it, or introduces silent regressions. We need an automated evaluation harness that:

- Runs on every PR and every push to `main` affecting the prompt.
- Catches regressions against a curated dataset of real bug cases.
- Is runnable manually during local prompt iteration.
- Costs pennies per run and fits the scope of a solo open-source project.

## 2. Goals / non-goals

### Goals

- Detect regressions against a fixed dataset of prompt-sensitive inputs (idioms, phrasal verbs, typos, junk, baseline common words).
- Score each case deterministically where possible, with small amounts of hand-curated "expected" output as golden targets.
- Gate CI on aggregate pass rate (fail the job when the prompt degrades).
- Keep evals runnable locally with `npm run eval` and `npm run eval:smoke`.

### Non-goals (v1)

- **Online / production evals.** Only offline evals against a fixed dataset.
- **LLM-as-judge.** All scoring in v1 is deterministic (regex, set membership, schema validation). Judge-based scoring can be layered in later without restructuring.
- **`translateText` evals.** The text-path prompt is a one-liner; the only prompt complexity worth testing lives in `translateWord`.
- **Baseline / historical trend comparison.** v1 uses absolute thresholds. Laminar, Promptfoo dashboards, or Braintrust can be added later — the code layout stays compatible.
- **Full language-pair matrix.** v1 evaluates the primary pair `en → uk`, plus one `uk → en` case (`синій птах`) carried via per-case `languagePair`.

## 3. Approach

Adopt the **Single-Turn Eval pattern** described in [agents-v2 / 03-Single-Turn-Evals](https://publish.obsidian.md/agents-v2/03-Single-Turn-Evals): each case has a category (`golden` | `secondary` | `negative`), pure scorer functions return `0..1`, and scorers are gated so they only apply to their category. The pattern is adapted from tool-selection evals to translation-quality evals; the category model is identical, the scorers are domain-specific.

No external SaaS (Laminar / Promptfoo / Braintrust). A small in-repo TypeScript harness run via `tsx` writes a JSON artifact and a human-readable summary; CI reads the exit code.

### Key design choices

- **Run each case `N = 3` times.** `gemini-2.5-flash-lite` supports `temperature` and `seed`, but Google documents only "best-effort" determinism. Averaging 3 runs per case smooths out residual jitter without meaningful cost.
- **Temperature `0`, fixed `seed` per case** (e.g. derived from the input string's hash) for maximum determinism.
- **Category-gated scorers.** A scorer returns `1` when not applicable (following the Obsidian pattern), so the aggregate stays interpretable.
- **One `languagePair` per case.** Most cases are `en → uk` (the extension's default); `синій птах` is `uk → en`. The harness does not hard-code a pair.

## 4. Architecture

### Directory layout

```
evals/
├── data/
│   ├── baseline.json        # common single words — smoke suite
│   ├── idioms.json          # idiomatic-meaning cases
│   ├── phrasal-verbs.json   # phrasal verb + hyphen/apostrophe cases
│   ├── typos.json           # misspelling → correctedWord cases
│   └── junk.json            # notAWord cases
├── evaluators.ts            # pure scorer functions, all exported
├── executor.ts              # wraps translateWord with retries + determinism knobs
├── runner.ts                # loads datasets, runs executors, applies scorers, aggregates
├── types.ts                 # EvalCase, EvalTarget, EvalResult, AggregateReport
└── translate.eval.ts        # CLI entry: `tsx evals/translate.eval.ts`
```

### Module responsibilities

| Module | Responsibility | Depends on |
|---|---|---|
| `types.ts` | `EvalCase`, `EvalTarget` (discriminated by `category`), `CaseRunResult`, `AggregateReport`. | Zod schemas in `src/lib/types.ts` (reused). |
| `evaluators.ts` | Pure scorers: `schemaValid`, `exampleUsesWord`, `scriptCorrect`, `hasExpectedTranslation`, `hasExpectedPOS`, `correctedWordEquals`, `sensesCoverExpected`, `avoidsForbiddenTranslation`, `notAWordCorrect`. Each `(output, target) => 0..1`. | `src/lib/gemini.ts` (for `exampleContainsWord` reuse), `src/lib/languages.ts`. |
| `executor.ts` | Calls `translateWord` with `temperature=0`, `seed=hash(input)`, runs `N=3×`, returns the three raw outputs (or error per attempt). Does not score. | `src/lib/gemini.ts`. |
| `runner.ts` | Loads all `*.json` datasets, applies executor, then applies applicable scorers per case, aggregates to `AggregateReport`. No I/O of its own. | `evaluators.ts`, `executor.ts`. |
| `translate.eval.ts` | CLI: reads env (`GEMINI_API_KEY`, `EVAL_SUITE=smoke|full`), calls `runner`, prints report, writes `evals/results-<ts>.json`, exits `0` or `1`. | `runner.ts`. |

### Data flow per case

1. `runner` hands an `EvalCase` to `executor.runCase(case)`.
2. Executor calls `translateWord(case.input, apiKey, case.languagePair, signal)` with determinism knobs, up to `N=3` times. Returns `CaseRunResult[]`.
3. Runner selects applicable scorers based on `case.target.category` and scorer metadata, calls each against each run, averages across runs.
4. Case passes when every applicable scorer's averaged value ≥ its threshold.
5. Aggregate: `suite.passRate = passedCases / totalCases`. Suite passes when `passRate >= SUITE_THRESHOLD` (default `0.9`).

> **Note on Gemini determinism knobs.** The current `callGemini` in `src/lib/gemini.ts` does not thread `temperature` / `seed` into the request body. Implementation will extend `callGemini` (or add an internal-only overload) to accept these, without changing the public `translateWord` signature.

## 5. Target schema, category labels, and scorer mapping

### Target schema (orthogonal, field-based)

A single case's `target` is an open record. Any scorer-specific field may be present or absent. Scorers gate **on field presence**, not on the `category` label — a case can combine Golden and Negative intent without ambiguity (e.g. `red herring` has both `expectedTranslation` and `forbiddenTranslation`).

```ts
type EvalTarget = {
  // Labeling only — not used for scorer gating.
  category: "golden" | "secondary" | "negative";

  // Golden-style: ANY regex matching ANY sense's translation passes.
  expectedTranslation?: RegExp[];

  // Golden-style: ANY regex matching ANY sense's partOfSpeech passes.
  expectedPOS?: RegExp[];

  // Golden-style (typo cases): correctedWord must equal this exactly.
  correctedWord?: string;

  // Secondary-style: fraction of regexes that must each match at least one sense.
  expectedTranslationsCover?: { regexes: RegExp[]; threshold: number };

  // Usable in any category: NO regex may match ANY sense's translation.
  forbiddenTranslation?: RegExp[];

  // Negative-style: the response must set notAWord === true.
  expectNotAWord?: boolean;
};
```

`category` is a **label** that drives reporting and documentation, not scoring. Scorer applicability is purely a function of which target fields are populated.

### Category labels (what each is for)

- **`golden`** — "this input MUST produce X." Usually carries `expectedTranslation`, often `expectedPOS`, sometimes `correctedWord`.
- **`secondary`** — "this input should cover K of N likely translations." Carries `expectedTranslationsCover` with `threshold ∈ (0, 1]`.
- **`negative`** — "this input must NOT produce X" or "must be rejected." Carries `forbiddenTranslation` and/or `expectNotAWord`.

A Golden-label case may still carry `forbiddenTranslation` when the primary assertion is about what it should produce **and** there's a known wrong-answer to guard against — e.g. `red herring` is labeled `golden` because the first-order requirement is the idiomatic translation; the forbidden literal is a secondary guard on the same case. No harm in one case exercising multiple scorers.

### Scorer reference

| Scorer | Gates on (target field present) | Threshold | Score |
|---|---|---|---|
| `schemaValid` | always | `1.0` | `0 \| 1` |
| `exampleUsesWord` | always | `1.0` | fraction of senses whose example contains the effective word |
| `scriptCorrect` | always | `1.0` | fraction of senses whose translation is in the target language's Unicode script |
| `hasExpectedTranslation` | `expectedTranslation` | `1.0` | `1` if ANY regex matches ANY sense's translation, else `0` |
| `hasExpectedPOS` | `expectedPOS` | `1.0` | `1` if ANY regex matches ANY sense's partOfSpeech, else `0` |
| `correctedWordEquals` | `correctedWord` | `1.0` | `1` if `output.correctedWord === target.correctedWord` |
| `sensesCoverExpected` | `expectedTranslationsCover` | `target.threshold` | fraction of required regexes each matched by ≥1 sense |
| `avoidsForbiddenTranslation` | `forbiddenTranslation` | `1.0` | `1` if NO regex matches ANY sense's translation, else `0` |
| `notAWordCorrect` | `expectNotAWord === true` | `1.0` | `1` if `output.notAWord === true`, else `0` |

A scorer for which the gating field is absent is **not applied** (not even as a free `1`). Aggregation divides only by scorers that actually ran.

## 6. Dataset (v1)

Every case is `en → uk` unless `languagePair` is specified.

### `baseline.json` — smoke suite

| Input | Category | Target fields |
|---|---|---|
| `hello` | golden | `expectedTranslation: [/привіт/, /вітаю/]`; `expectedPOS: [/interjection/i, /greeting/i, /phrase/i, /exclamation/i]`. |
| `book` | secondary | `expectedTranslationsCover: { regexes: [/книга/, /книжка/, /бронювати/], threshold: 0.5 }`. |
| `run` | secondary | `expectedTranslationsCover: { regexes: [/бігти/, /керувати/, /запускати/], threshold: 0.5 }`. |
| `bank` | secondary | `expectedTranslationsCover: { regexes: [/банк/, /берег/, /схил/], threshold: 0.5 }`. |
| `cat` | golden | `expectedTranslation: [/кіт/, /кішка/]`; `expectedPOS: [/noun/i]`. |

### `idioms.json`

| Input | Category | Target fields |
|---|---|---|
| `red herring` | golden | `expectedTranslation: [/оманлив/, /обманн/, /відволікаюч/]`; `expectedPOS: [/idiom/i, /phrase/i, /expression/i]`; `forbiddenTranslation: [/червоний оселедець/]`. |
| `kick the bucket` | golden | `expectedTranslation: [/померти/, /вмерти/, /врізати дуба/, /відкинути копита/]`; `forbiddenTranslation: [/кинути відро/, /бити відро/]`. |
| `beat around the bush` | golden | `expectedTranslation: [/уникати/, /ходити навколо/, /викручуватися/, /ходити довкола/]`. |
| `the best of both worlds` | golden | `expectedTranslation: [/найкращ/, /обох світів/, /обидв/]`; `expectedPOS: [/idiom/i, /expression/i]`. |
| `синій птах` (`uk → en`) | golden | `expectedTranslation: [/blue bird/i, /blue-bird/i, /bluebird/i, /bird of happiness/i, /symbol of happiness/i]`. |

### `phrasal-verbs.json`

| Input | Category | Target fields |
|---|---|---|
| `give up` | golden | `expectedTranslation: [/здатися/, /здаватися/, /припинити/, /відмовитися/]`; `expectedPOS: [/phrasal verb/i, /verb/i]`. |
| `break down` | golden | `expectedTranslation: [/зламатися/, /вийти з ладу/, /зіпсуватися/, /розпастися/]`. |
| `don't give up` | golden | accepts apostrophe; `expectedTranslation: [/не здавайся/, /не здавайтеся/]`. |
| `well-known fact` | golden | accepts hyphen; `expectedTranslation: [/загальновідомий факт/, /відомий факт/, /широковідом/]`. |

### `typos.json`

| Input | Category | Target fields |
|---|---|---|
| `red hering` | golden | `correctedWord: "red herring"`; `expectedTranslation: [/оманлив/, /обманн/, /відволікаюч/]`; `forbiddenTranslation: [/червоний оселедець/]`. |
| `kik the bucket` | golden | `correctedWord: "kick the bucket"`; `expectedTranslation: [/померти/, /вмерти/, /врізати дуба/, /відкинути копита/]`; `forbiddenTranslation: [/кинути відро/]`. |

### `junk.json`

| Input | Category | Target fields |
|---|---|---|
| `fahj89sdf` | negative | `expectNotAWord: true`. |
| `zzqpplx` | negative | `expectNotAWord: true` (second non-word, avoids a single-case flaky gate). |

> **Pre-filter cases are out of scope.** `12345`, `COVID-19`, `e.g.`, `Mr.`, whitespace variants inside example validation, and false-positive phrase matches (`red` vs `red herring`, `gave uplifting` vs `give up`) are caught before Gemini is called, by `looksLikeWordAttempt` and `exampleContainsWord`. Those are **unit tests**, not prompt evals, and should be verified separately in `src/lib/input.test.ts` / `src/lib/gemini.test.ts`.

### Total case count

~18 cases. At `N=3` runs each, ~54 Gemini API calls per full run. Well within free-tier quota; a full run completes in well under a minute.

## 7. Execution modes

### Local manual

```bash
npm run eval          # full suite
npm run eval:smoke    # baseline.json only (~5 cases, ~15 calls)
```

Requires `GEMINI_API_KEY` in the local environment (read from `.env` if present — add to `.gitignore` verification).

### CI (GitHub Actions)

`.github/workflows/prompt-eval.yml`:

- **Triggers:** `push` to `main` and `pull_request` with `paths: [src/lib/gemini.ts, evals/**]`. Avoids running on unrelated PRs.
- **Secret:** `GEMINI_API_KEY` (repository secret).
- **Step:** `npm ci && npm run eval`.
- **Output:** the runner writes a markdown summary to `$GITHUB_STEP_SUMMARY`, attaches `evals/results-<ts>.json` as an artifact.
- **Gate:** non-zero exit fails the job, blocks merge.

## 8. Reporting format

### Terminal + `$GITHUB_STEP_SUMMARY`

```
VOCABUILDER PROMPT EVAL — 2026-04-15T14:22:10Z
  Suite: full (18 cases, 3 runs each)
  Pair:  en → uk (+ 1 uk → en case)

  baseline.json       [5/5]  ✓
  idioms.json         [4/5]  ✗  the best of both worlds
  phrasal-verbs.json  [4/4]  ✓
  typos.json          [2/2]  ✓
  junk.json           [2/2]  ✓

  PASS RATE: 17/18 (94.4%)  threshold 90%  →  PASS
```

Per-failed-case detail (scorer-level scores, first failing output) is written to the JSON artifact.

### JSON artifact shape (summary)

```ts
type AggregateReport = {
  startedAt: string;            // ISO
  durationMs: number;
  suite: "smoke" | "full";
  languagePair: { source: string; target: string };
  cases: {
    input: string;
    category: "golden" | "secondary" | "negative";
    passed: boolean;
    scorerScores: Record<string, number>; // averaged across N runs
    runs: { outputOrError: unknown }[];   // raw for debugging
  }[];
  passRate: number;
  threshold: number;
  passed: boolean;              // passRate >= threshold
};
```

## 9. Error handling

- **Network / API errors during a run.** Treat that run as a failure for every applicable scorer (`0`). Case-level score averages across the three runs. If all three fail transport (e.g., API down), the runner aborts with a non-zero exit code and a distinct message, so a real outage doesn't masquerade as a prompt regression.
- **Schema validation failure.** `schemaValid = 0`. The executor still records the raw output for the artifact.
- **Invalid dataset file.** `runner` parses datasets with Zod at startup; a malformed dataset fails fast before any API calls.
- **Missing API key.** `translate.eval.ts` exits early with a clear message; no network call made.

## 10. Testing

Per the project rule "always write tests with code changes":

- **Unit tests for each scorer** in `evals/evaluators.test.ts`, stubbing the `GeminiWordResponse` shape. Cover: target-not-present → `1`; partial-match; full-match; script mismatch; etc.
- **Unit tests for dataset parsing** — every `data/*.json` must parse under the Zod schema used by the runner (caught at startup, tested explicitly).
- **No integration tests that hit Gemini.** The evals are themselves the integration layer. Vitest is reserved for deterministic code.

## 11. Open questions (answer before implementation)

1. **Suite threshold.** Default proposed: **90%** (i.e. at most ~2 of 18 cases may fail without blocking). Alternatives: `100%` (zero-tolerance, prone to flakes on Gemini jitter) or `95%`.
2. **Per-case `expectedTranslation` regex lists.** Drafted above. The Ukrainian lists should be validated by a native speaker before the dataset is frozen. Proposed plan: land the dataset as drafted, and treat the first CI run's failures as a review signal — adjust regexes that are too strict, not the prompt.
3. **Run count `N`.** Proposed `N = 3` per case. Bumping to `N = 5` triples confidence at ~double the cost. `N = 1` is cheapest but more flaky. Accept `N = 3`?

## 12. Forward compatibility

The chosen shape (pure scorers + category-gated targets + per-case `languagePair`) is compatible with:
- **Adding LLM-as-judge** as another scorer returning `0..1`.
- **Adding Laminar / Promptfoo** dashboards — they expect exactly this `(output, target) => score` contract.
- **Adding more language pairs** by adding cases with `languagePair` set.
- **Adding `translateText` evals** as a sibling suite under `evals/data/text/` with its own executor and scorers.

None of these require restructuring the v1 design.
