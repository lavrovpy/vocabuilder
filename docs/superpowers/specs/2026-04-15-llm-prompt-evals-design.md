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
- **Two-tier scoring (hard / soft).** The CI gate uses only hard scorers — checks where a violation is unambiguously wrong (schema invalid, wrong script, literal idiom translation, typo not corrected, junk not rejected). Soft scorers test "did the LLM pick one of the synonyms we expected?" and are reported as drift signal but never fail the build. Rationale: regex-based expected-translation lists are brittle as gates because legitimately good translations may use synonyms not on the list, which over time calcifies whatever Gemini happened to output on Day 1 as the definition of correct.
- **Pre-freeze harvest.** Soft-tier regex lists are expanded by running each case `N=20×` at higher temperature, then having a native speaker mark each distinct translation as VALID/INVALID before the dataset is frozen. See §13.
- **Field-presence gating, not category gating.** A scorer is **not applied** when its target field is absent (not even as a free `1`). Aggregation divides only by scorers that actually ran.
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
| `evaluators.ts` | Pure scorers tagged with tier (`hard` \| `soft`): hard = `schemaValid`, `exampleUsesWord`, `scriptCorrect`, `correctedWordEquals`, `avoidsForbiddenTranslation`, `notAWordCorrect`; soft = `hasPreferredTranslation`, `hasPreferredPOS`, `sensesCoverPreferred`. Each `(output, target) => 0..1`. | `src/lib/gemini.ts` (for `exampleContainsWord` reuse), `src/lib/languages.ts`. |
| `executor.ts` | Calls `translateWord` with `temperature=0`, `seed=hash(input)`, runs `N=3×`, returns the three raw outputs (or error per attempt). Does not score. | `src/lib/gemini.ts`. |
| `runner.ts` | Loads all `*.json` datasets, applies executor, then applies applicable scorers per case, aggregates to `AggregateReport`. No I/O of its own. | `evaluators.ts`, `executor.ts`. |
| `translate.eval.ts` | CLI: reads env (`GEMINI_API_KEY`, `EVAL_SUITE=smoke|full`), calls `runner`, prints report, writes `evals/results-<ts>.json`, exits `0` or `1`. | `runner.ts`. |

### Data flow per case

1. `runner` hands an `EvalCase` to `executor.runCase(case)`.
2. Executor calls `translateWord(case.input, apiKey, case.languagePair, signal)` with determinism knobs, up to `N=3` times. Returns `CaseRunResult[]`.
3. Runner selects applicable scorers based on which target fields are populated, calls each against each run, averages across runs.
4. **Case passes the CI gate** when every applicable **hard-tier** scorer's averaged value ≥ its threshold. Soft-tier results are recorded but do not affect the gate.
5. Aggregate: `suite.passRate = passedCases / totalCases` (hard tier only). Suite passes CI when `passRate >= SUITE_THRESHOLD` (default `0.9`). The drift section reports per-case soft-tier averages for human review.

> **Note on Gemini determinism knobs.** The current `callGemini` in `src/lib/gemini.ts` does not thread `temperature` / `seed` into the request body. Implementation will extend `callGemini` (or add an internal-only overload) to accept these, without changing the public `translateWord` signature.

## 5. Target schema, category labels, and scorer mapping

### Two-tier scoring

Scorers are split into two tiers:

- **Hard tier** — gates CI. A case fails the suite if any applicable hard-tier scorer drops below its threshold. Hard scorers test things that are **unambiguously wrong** when violated: schema invalid, wrong-script output, literal-translation of an idiom, typo not corrected, junk not rejected.
- **Soft tier** — observed but does **not** gate CI. Soft scorers test "did the LLM produce one of the synonyms we expected?" — useful as a drift signal but brittle as a gate, because legitimately good translations may use synonyms not on the list.

Why split: a regex list of expected translations does two jobs at once — (1) ruling out semantically wrong answers, (2) ruling out valid synonyms not on the list. Job (1) is what we want to gate on, but job (2) is what regex coverage actually tests. Promoting that to a hard gate forces a maintenance treadmill of "Gemini returned a new valid synonym → CI red → expand regex list," which over time calcifies whatever Gemini happened to output on Day 1 as the definition of correct, and trains the human reflex to dismiss eval failures.

The hard gate becomes: **schema valid + script correct + example uses word + nothing forbidden + corrected-word matches (when applicable) + notAWord correct (when applicable)**. Translation-content quality is observed via the soft tier.

### Target schema (orthogonal, field-based)

A single case's `target` is an open record. Any scorer-specific field may be present or absent. Scorers gate **on field presence**, not on the `category` label — a case can combine Golden and Negative intent without ambiguity (e.g. `red herring` has both `preferredTranslation` and `forbiddenTranslation`).

```ts
type EvalTarget = {
  // Labeling only — not used for scorer gating.
  category: "golden" | "secondary" | "negative";

  // SOFT tier (drift signal, not CI gate): ANY regex matching ANY sense's translation
  // contributes to the case's drift score. Reported separately, never fails the build.
  preferredTranslation?: RegExp[];

  // SOFT tier: ANY regex matching ANY sense's partOfSpeech contributes to the drift score.
  preferredPOS?: RegExp[];

  // SOFT tier: fraction of regexes that must each match at least one sense
  // (replaces secondary-style coverage; informational only).
  preferredTranslationsCover?: { regexes: RegExp[]; threshold: number };

  // HARD tier (CI gate): for typo cases, correctedWord must equal this exactly.
  // The expected correction is unambiguous, so this stays a hard gate.
  correctedWord?: string;

  // HARD tier (CI gate): NO regex may match ANY sense's translation.
  // Used to guard against literal translations of idioms, etc. The forbidden answer
  // is unambiguous (there's only one way to write the wrong answer), so this is robust.
  forbiddenTranslation?: RegExp[];

  // HARD tier (CI gate): the response must set notAWord === true.
  expectNotAWord?: boolean;
};
```

`category` is a **label** that drives reporting and documentation, not scoring. Scorer applicability is purely a function of which target fields are populated.

### Category labels (what each is for)

- **`golden`** — "this input MUST produce X." Usually carries `preferredTranslation` (soft), often `preferredPOS` (soft), sometimes `correctedWord` (hard).
- **`secondary`** — "this input should cover K of N likely translations." Carries `preferredTranslationsCover` (soft) with `threshold ∈ (0, 1]`.
- **`negative`** — "this input must NOT produce X" or "must be rejected." Carries `forbiddenTranslation` (hard) and/or `expectNotAWord` (hard).

A Golden-label case may still carry `forbiddenTranslation` when there's a known wrong-answer to guard against — e.g. `red herring` is labeled `golden` because the first-order intent is the idiomatic translation; the forbidden literal is the actual hard gate on that case. No harm in one case exercising scorers from both tiers.

### Scorer reference

| Tier | Scorer | Gates on (target field present) | Threshold | Score |
|---|---|---|---|---|
| **Hard** | `schemaValid` | always | `1.0` | `0 \| 1` |
| **Hard** | `exampleUsesWord` | always | `1.0` | fraction of senses whose example contains the effective word |
| **Hard** | `scriptCorrect` | always | `1.0` | fraction of senses whose translation is in the target language's Unicode script |
| **Hard** | `correctedWordEquals` | `correctedWord` | `1.0` | `1` if `output.correctedWord === target.correctedWord` |
| **Hard** | `avoidsForbiddenTranslation` | `forbiddenTranslation` | `1.0` | `1` if NO regex matches ANY sense's translation, else `0` |
| **Hard** | `notAWordCorrect` | `expectNotAWord === true` | `1.0` | `1` if `output.notAWord === true`, else `0` |
| Soft | `hasPreferredTranslation` | `preferredTranslation` | n/a (observed) | `1` if ANY regex matches ANY sense's translation, else `0` |
| Soft | `hasPreferredPOS` | `preferredPOS` | n/a (observed) | `1` if ANY regex matches ANY sense's partOfSpeech, else `0` |
| Soft | `sensesCoverPreferred` | `preferredTranslationsCover` | n/a (observed) | fraction of preferred regexes each matched by ≥1 sense |

A scorer for which the gating field is absent is **not applied**. The case **passes the CI gate** when every applicable **hard** scorer's averaged value ≥ its threshold. Soft scorer outcomes are recorded in the artifact and rendered in the report under a "drift" section — they never flip the build to red.

## 6. Dataset (v1)

Every case is `en → uk` unless `languagePair` is specified.

The hard gate for every translation case is `schemaValid + exampleUsesWord + scriptCorrect`, plus any `forbiddenTranslation` / `correctedWord` / `expectNotAWord` listed below. The `preferredTranslation` / `preferredPOS` lists are **soft tier** — drift signal only. The regex lists shown here are the v1 draft to be expanded by the [pre-freeze harvest](#13-pre-freeze-harvest-workflow); they do not need to be exhaustive at design time.

### `baseline.json` — smoke suite

| Input | Category | Target fields |
|---|---|---|
| `hello` | golden | `preferredTranslation: [/привіт/, /вітаю/]` (soft); `preferredPOS: [/interjection/i, /greeting/i, /phrase/i, /exclamation/i]` (soft). |
| `book` | secondary | `preferredTranslationsCover: { regexes: [/книга/, /книжка/, /бронювати/], threshold: 0.5 }` (soft). |
| `run` | secondary | `preferredTranslationsCover: { regexes: [/бігти/, /керувати/, /запускати/], threshold: 0.5 }` (soft). |
| `bank` | secondary | `preferredTranslationsCover: { regexes: [/банк/, /берег/, /схил/], threshold: 0.5 }` (soft). |
| `cat` | golden | `preferredTranslation: [/кіт/, /кішка/]` (soft); `preferredPOS: [/noun/i]` (soft). |

### `idioms.json`

| Input | Category | Target fields |
|---|---|---|
| `red herring` | golden | **HARD**: `forbiddenTranslation: [/червоний оселедець/]`. Soft: `preferredTranslation: [/оманлив/, /обманн/, /відволікаюч/, /хибн/, /приманк/]`; `preferredPOS: [/idiom/i, /phrase/i, /expression/i]`. |
| `kick the bucket` | golden | **HARD**: `forbiddenTranslation: [/кинути відро/, /бити відро/]`. Soft: `preferredTranslation: [/померти/, /вмерти/, /врізати дуба/, /відкинути копита/, /віддати богу душу/, /сконати/, /піти на той світ/]`. |
| `beat around the bush` | golden | Soft only: `preferredTranslation: [/уникати/, /ходити навколо/, /викручуватися/, /ходити довкола/, /ходити манівцями/, /тягнути час/]`. *(No clear forbidden-literal — "бити навколо куща" is rare enough that it's not a meaningful guard. Hard gate falls to structural scorers + harvest expansion.)* |
| `the best of both worlds` | golden | Soft only: `preferredTranslation: [/найкращ/, /обох світів/, /обидв/]`; `preferredPOS: [/idiom/i, /expression/i]`. |
| `синій птах` (`uk → en`) | golden | Soft: `preferredTranslation: [/blue bird/i, /blue-bird/i, /bluebird/i, /bird of happiness/i, /symbol of happiness/i]`. |

### `phrasal-verbs.json`

| Input | Category | Target fields |
|---|---|---|
| `give up` | golden | Soft: `preferredTranslation: [/здатися/, /здаватися/, /припинити/, /відмовитися/]`; `preferredPOS: [/phrasal verb/i, /verb/i]`. |
| `break down` | golden | Soft: `preferredTranslation: [/зламатися/, /вийти з ладу/, /зіпсуватися/, /розпастися/]`. |
| `don't give up` | golden | Accepts apostrophe (structural). Soft: `preferredTranslation: [/не здавайся/, /не здавайтеся/]`. |
| `well-known fact` | golden | Accepts hyphen (structural). Soft: `preferredTranslation: [/загальновідомий факт/, /відомий факт/, /широковідом/]`. |

### `typos.json`

| Input | Category | Target fields |
|---|---|---|
| `red hering` | golden | **HARD**: `correctedWord: "red herring"`; `forbiddenTranslation: [/червоний оселедець/]`. Soft: `preferredTranslation: [/оманлив/, /обманн/, /відволікаюч/, /хибн/, /приманк/]`. |
| `kik the bucket` | golden | **HARD**: `correctedWord: "kick the bucket"`; `forbiddenTranslation: [/кинути відро/]`. Soft: `preferredTranslation: [/померти/, /вмерти/, /врізати дуба/, /відкинути копита/, /віддати богу душу/]`. |

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
npm run eval          # full suite (hard tier gates exit code; soft tier reported)
npm run eval:smoke    # baseline.json only (~5 cases, ~15 calls)
npm run eval:harvest  # harvest mode — see §13. Runs each case N=20× and writes
                      # evals/harvest/<dataset>.review.json for native-speaker review.
                      # Does NOT score; intended for one-time pre-freeze regex curation.
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

  HARD TIER (CI gate)
    baseline.json       [5/5]  ✓
    idioms.json         [4/5]  ✗  red herring (forbidden literal returned)
    phrasal-verbs.json  [4/4]  ✓
    typos.json          [2/2]  ✓
    junk.json           [2/2]  ✓
    PASS RATE: 17/18 (94.4%)  threshold 90%  →  PASS

  SOFT TIER (drift, informational)
    Cases below 1.0 on preferredTranslation:
      hello                preferredTranslation: 0.33   (returned: "доброго дня")
      beat around the bush preferredTranslation: 0.00   (returned: "розводити теревені")
    No drift on 14 of 16 soft-scored cases.
```

Per-failed-case detail (scorer-level scores, first failing output) is written to the JSON artifact. The soft-tier drift section never affects exit code; it's a signal that the regex lists are missing valid synonyms (→ candidates for the next harvest pass) or that the prompt may be drifting in style. **Repeated soft-tier misses for the same case across iterations are the strongest signal that a harvest pass is overdue.**

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
    passed: boolean;            // hard-tier only
    scorerScores: {
      hard: Record<string, number>;   // averaged across N runs; gates passed
      soft: Record<string, number>;   // averaged across N runs; informational only
    };
    runs: { outputOrError: unknown }[];   // raw for debugging
  }[];
  passRate: number;             // hard-tier pass rate
  threshold: number;
  passed: boolean;              // passRate >= threshold
  drift: {
    casesWithSoftMisses: number;
    perCase: { input: string; softScorer: string; score: number }[];
  };
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

1. **Suite threshold.** Default proposed: **90%** (i.e. at most ~2 of 18 cases may fail without blocking). Alternatives: `100%` (zero-tolerance, prone to flakes on Gemini jitter) or `95%`. Note: this threshold applies to the **hard tier only**; the soft tier never gates.
2. **Soft-tier reporting policy.** Drift is informational by default. Two follow-up questions for the user to decide:
   - Should a *sustained* soft-tier miss across N consecutive CI runs upgrade to a warning comment on the PR? (Catches slow drift without making CI flaky.)
   - Should the harvest workflow be re-runnable per-case (selective) or only as a full sweep?
3. **Run count `N`.** Proposed `N = 3` per case for scoring runs; `N = 20` per case for harvest runs (one-time, higher temperature). Bumping scoring to `N = 5` triples confidence at ~double the cost. `N = 1` is cheapest but more flaky. Accept `N = 3` for scoring?
4. **Cases without a clear forbidden answer.** `beat around the bush`, `the best of both worlds`, `cat`, `hello`, `book`/`run`/`bank` have no obvious literal-mistranslation to forbid. For these, the hard gate falls entirely to the structural scorers (`schemaValid + scriptCorrect + exampleUsesWord`). Open question: is that strong enough, or do we want to introduce a generic "translation must be in target language and non-empty" gate beyond `scriptCorrect`?

## 12. Forward compatibility

The chosen shape (pure scorers + category-gated targets + per-case `languagePair`) is compatible with:
- **Adding LLM-as-judge** as another scorer returning `0..1`.
- **Adding Laminar / Promptfoo** dashboards — they expect exactly this `(output, target) => score` contract.
- **Adding more language pairs** by adding cases with `languagePair` set.
- **Adding `translateText` evals** as a sibling suite under `evals/data/text/` with its own executor and scorers.

None of these require restructuring the v1 design.

## 13. Pre-freeze harvest workflow

Before the dataset is frozen for CI use, the soft-tier `preferredTranslation` regex lists are expanded by harvesting Gemini's actual output across many runs and asking a native speaker to mark each distinct translation as valid or invalid. This is a **one-time per-case** activity (rerun only when adding a new case or making a major prompt change).

### Why

Hand-drafted regex lists capture what the spec author thought of, not what's natural for the language. Harvesting surfaces synonyms the author missed (e.g. "хибний слід" for `red herring`, "ходити манівцями" for `beat around the bush`) and lets the soft tier's drift signal be calibrated against a real corpus rather than the author's first guess.

### Mode of operation

`npm run eval:harvest` runs in a separate mode from the scoring runner:

1. Loads all `evals/data/*.json` cases.
2. For each case, calls `translateWord` with `temperature=0.7` (intentionally higher than scoring runs — we want diversity, not determinism) `N=20` times.
3. Collects every distinct `(translation, partOfSpeech)` pair across all runs and all senses, with frequency counts.
4. Writes one JSON file per dataset to `evals/harvest/<dataset>.review.json`, validated by `HarvestReviewSchema`. Shape:

   ```json
   {
     "version": 1,
     "dataset": "idioms.json",
     "generatedAt": "2026-04-15T14:22:10Z",
     "config": { "runs": 20, "temperature": 0.7 },
     "cases": [
       {
         "input": "red herring",
         "alreadyPreferred": [{ "source": "оманлив" }, { "source": "хибн" }],
         "alreadyForbidden": [{ "source": "червоний оселедець" }],
         "observations": [
           { "translation": "оманливий хід", "partOfSpeech": "noun", "runs": 12, "tag": null, "decision": null },
           { "translation": "червоний оселедець", "partOfSpeech": "idiom", "runs": 1, "tag": "alreadyForbidden", "decision": null }
         ]
       }
     ]
   }
   ```

5. The native speaker edits each `"decision": null` to `"v"` (valid → merge into `preferredTranslation`), `"i"` (invalid → skip), or `"f"` (forbid → append to `forbiddenTranslation`). Three keystrokes per row.
6. `npm run eval:harvest -- --apply evals/harvest/idioms.review.json` reads the marked JSON file (Zod-validated; typos like `"valdi"` fail loudly with the exact path) and merges decisions into the corresponding `preferredTranslation` / `forbiddenTranslation` lists in `evals/data/*.json`. The mutated dataset is written via `<file>.json.tmp` + `renameSync` for atomicity, and re-validated with `EvalDatasetSchema` before the rename.

### When to harvest

- **Pre-freeze (mandatory):** before turning on CI gating. Every case with `preferredTranslation` gets harvested once.
- **Adding a new case:** harvest the new case before merging.
- **Major prompt change:** if the prompt is rewritten (vs. tweaked), re-harvest cases whose drift score regressed.

The harvest results are committed to `evals/data/*.json`. The intermediate review files in `evals/harvest/` are gitignored — they're scratch space for the reviewer, not artifacts.

### Cost

`~18 cases × 20 runs = 360 calls` per full harvest, well within the Gemini free tier. Run time ~3 minutes. Done once per case lifetime, not per CI run.
