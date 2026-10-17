# Translation evaluations

The suite tests the production `translateWord` result: validated, deduplicated senses or a deterministic application error. It covers word and short-expression lookup; `translateText` is outside its scope.

## Choose a run

Use the project's Node/npm versions from `.nvmrc`. Set `GEMINI_API_KEY` in `.env`, starting from [`.env.example`](../.env.example). The default candidate uses the extension's Gemini model; the judge defaults to `google:gemini-3-flash-preview`.

| Command                  |         Cases | Candidates                | Use                                                                                   |
| ------------------------ | ------------: | ------------------------- | ------------------------------------------------------------------------------------- |
| `npm run eval:validate`  |             — | —                         | Check configuration without keys or model calls.                                      |
| `npm run eval:smoke`     |            12 | Gemini                    | Quick iteration with fixed Latin, Cyrillic, and CJK cases.                            |
| `npm run eval`           |            96 | Gemini                    | Routine regression check across all 17 supported languages.                           |
| `npm run eval:matrix`    |           272 | Gemini                    | Check every directed language pair with a common-word probe.                          |
| `npm run eval:all`       |           368 | Gemini                    | Run standard and matrix coverage together.                                            |
| `npm run eval:providers` | 96 per vendor | Gemini, Anthropic, OpenAI | Compare production providers; also requires `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`. |

Live runs make a candidate request and a semantic judge request for each case, except when input validation rejects the candidate locally. The matrix is intentionally opt-in because of its cost.

## Configure candidates and the judge

Candidate keys come from their native variables: `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, and `OPENAI_API_KEY`. Candidate models and endpoints use the extension's defaults unless overridden.

| Setting                                                                                                          | Scope                                                                                             |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `EVAL_TRANSLATION_API_KEY`, `EVAL_TRANSLATION_API_BASE_URL`, `EVAL_TRANSLATION_MODEL`                            | Gemini candidate only.                                                                            |
| `GEMINI_BASE_URL` / `GEMINI_MODEL`, `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL`, `OPENAI_BASE_URL` / `OPENAI_MODEL` | Candidate vendor overrides. A vendor's URL/model takes precedence over the Gemini role overrides. |
| `EVAL_JUDGE_API_KEY`                                                                                             | Judge only; defaults to `GEMINI_API_KEY`.                                                         |
| `EVAL_JUDGE_API_BASE_URL`                                                                                        | Judge only; defaults to Google's API origin.                                                      |
| `EVAL_JUDGE_PROVIDER_ID`                                                                                         | Judge provider and model, such as `google:gemini-3-flash-preview`.                                |

A candidate entry's `config.model` takes precedence over environment model overrides. Keep the judge's key, endpoint, and provider ID consistent when switching vendors or using a proxy. For example, an OpenAI judge uses:

```dotenv
EVAL_JUDGE_API_KEY=<judge key>
EVAL_JUDGE_API_BASE_URL=https://api.openai.com/v1
EVAL_JUDGE_PROVIDER_ID=openai:responses:gpt-6-luna
```

`OPENAI_API_KEY` still belongs to the OpenAI candidate. The launcher preserves candidate credentials before mapping the judge key to the native variable Promptfoo requires. A missing candidate key remains an error even when a judge key exists for that vendor.

Keys stay in the process environment. Keep them out of YAML provider configuration because that configuration can be retained in exported results.

To evaluate an OpenAI-compatible server, add an entry to [`promptfooconfig.yaml`](../evals/promptfooconfig.yaml) with `config.provider: openai-compatible` and `config.model`. Set `OPENAI_COMPATIBLE_API_KEY` and `OPENAI_COMPATIBLE_BASE_URL`; run the launcher with a matching provider filter. The normal scripts retain their native-vendor selection.

## Read the results

Results live in the ignored `evals/results/` directory. The standard run writes `promptfoo.json` and `summary.md`; smoke, matrix, all, and providers runs append the corresponding suffix to both names, such as `promptfoo-smoke.json` and `summary-smoke.md`.

The Markdown report groups pass rates by language pair, category, difficulty, and tier, then lists individual failures and provider errors. Completed runs generate the report even below the pass-rate threshold and retain the failing exit code. Starting a run clears its previous JSON and summary so an early failure cannot leave a stale report.

Use `npm run eval:results` for Promptfoo's viewer. Regenerate the standard summary with `npm run eval:report`, or another summary with:

```bash
mise exec -- npx tsx evals/promptfoo/report.ts evals/results/promptfoo-smoke.json evals/results/summary-smoke.md
```

CI runs the 96-case Gemini suite and uploads JSON and Markdown artifacts even when the evaluation fails.

The **75% aggregate threshold is a permissive compatibility gate**, not release acceptance. Inspect every zero-pass pair and every subgroup below 75%, even when the overall run passes:

1. Separate provider errors from failed translation assertions.
2. Read the candidate output and the deterministic or judge reason for each affected case.
3. Classify the cause as a candidate regression, judge disagreement, or provider failure. Promote real matrix failures into standard regression cases.

## What each layer establishes

The standard suite uses English as a pivot to keep routine cost bounded: every other language has at least two cases in each direction through English, with additional ambiguity, idiom, false-friend, correction, and rejection cases. English→Ukrainian has extra coverage for the default pair. Non-English pairs are exercised only by the matrix.

The matrix translates each source language's word for “water” into the other 16 languages. A pass establishes basic pair viability; it says little about idioms, register, or morphology for that pair.

Two assertions grade each result:

- **Application contract:** [`assert-output.cjs`](../evals/promptfoo/assert-output.cjs) checks projection, exact outcome/correction fields, one to five complete unique senses, source-form examples, and explicit known-wrong glosses. Sense identity, forbidden forms, and source-form matching use NFKC normalization, trimming, and lowercasing; source-form matching is a substring check without stemming.
- **Translation quality:** [`judge-prompt.txt`](../evals/promptfoo/judge-prompt.txt) and the YAML rubric grade meaning, useful sense coverage, target-language quality, and natural paired examples. Any failed applicable criterion fails the semantic assertion. Inputs and candidate output are treated as untrusted evidence.

The judge has not been calibrated against a human-labeled holdout set. Use native-speaker review and repeated runs before treating its score as release evidence or tightening the threshold.

## Maintain coverage

Add cases in [`cases.cjs`](../evals/promptfoo/cases.cjs). Keep IDs stable, classify each case, and choose the fixed smoke tier deliberately. Adding a language requires cases in both English-pivot directions and a matrix source word; the suite tests check agreement with the application's language registry.

Keep exact application expectations in the deterministic assertion and linguistic judgments in the rubric. Address related-language drift in the production prompt rather than expanding forbidden-word lists. Changes to the exact source-form example contract must update the production prompt, assertion, and cases together.

Configuration policy lives in [`promptfooconfig.yaml`](../evals/promptfooconfig.yaml): threshold, backoff, concurrency, and sharing. `.env` holds run-specific credentials and model/endpoint overrides. YAML-pinned environment values take precedence over `.env`.

Before submitting changes, run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run eval:validate`. Launcher regression tests use mocked HTTP and local echo-provider evaluations, so they need no live keys or paid calls.
