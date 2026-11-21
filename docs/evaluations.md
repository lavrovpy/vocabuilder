# Translation evaluations

The suite tests the production `translateWord` result: validated, deduplicated senses or a deterministic application error. It covers word and short-expression lookup; `translateText` is outside its scope.

## Choose a run

Use the project's Node/npm versions from `.nvmrc`. Set `ANTHROPIC_API_KEY` in `.env`, starting from [`.env.example`](../.env.example). Every live run names its candidates and its judge:

```bash
npm run eval -- --model anthropic --judge anthropic/claude-sonnet-5-5                        # what the CI workflow runs
npm run eval -- --model anthropic --model gemini --model openai --judge anthropic/claude-sonnet-5-5
npm run eval -- --model anthropic/claude-sonnet-5-5 --judge vertex/gemini-3.1-pro
```

| Command                 | Cases | Use                                                          |
| ----------------------- | ----: | ------------------------------------------------------------ |
| `npm run eval:validate` |     — | Check configuration without keys or model calls.             |
| `npm run eval:smoke`    |    12 | Quick iteration with fixed Latin, Cyrillic, and CJK cases.   |
| `npm run eval`          |   105 | Routine regression check across all 17 supported languages.  |
| `npm run eval:matrix`   |   272 | Check every directed language pair with a common-word probe. |

The three run scripts take the same `--model` and `--judge` flags, and the case count applies to each `--model`. Any other argument goes to Promptfoo, such as `--filter-first-n 2`. Live runs make a candidate request and a semantic judge request for each case, except when input validation rejects the candidate locally. The matrix is intentionally opt-in because of its cost.

## Configure candidates and the judge

Both flags take `<route>/<model>`, split at the first slash. A route alone (`--model anthropic`) runs the extension's default model for that provider with its own reasoning effort; passing the default's ID explicitly drops that effort, so CI uses the route alone. `--judge` always needs a model.

| Route               | `--model`                                              | `--judge` becomes             | Credentials                                                |
| ------------------- | ------------------------------------------------------ | ----------------------------- | ---------------------------------------------------------- |
| `gemini`            | route alone = production default                       | `google:<model>`              | `GEMINI_API_KEY` (the judge also accepts `GOOGLE_API_KEY`) |
| `anthropic`         | route alone = production default                       | `anthropic:messages:<model>`  | `ANTHROPIC_API_KEY`                                        |
| `openai`            | route alone = production default                       | `openai:responses:<model>`    | `OPENAI_API_KEY`                                           |
| `openrouter`        | model required; uses the `openai-compatible` transport | `openrouter:<model>`          | `OPENROUTER_API_KEY`                                       |
| `openai-compatible` | model required                                         | —                             | `OPENAI_COMPATIBLE_API_KEY`, `OPENAI_COMPATIBLE_BASE_URL`  |
| `vertex`            | —                                                      | `vertex:<model>`              | Google Cloud login (ADC) and `GOOGLE_CLOUD_PROJECT`        |
| `bedrock`           | —                                                      | `bedrock:converse:<model-id>` | AWS credentials and `AWS_BEDROCK_REGION`                   |

A missing route, model, or variable stops the run before any request. `GEMINI_BASE_URL`, `ANTHROPIC_BASE_URL` and `OPENAI_BASE_URL` point a candidate at another server, such as a local proxy.

`EVAL_JUDGE_API_KEY` and `EVAL_JUDGE_API_BASE_URL` give a key-based judge its own key or server. The runner puts that key in the judge's native variable and keeps a candidate on the same route on its own key, so an OpenAI judge with `EVAL_JUDGE_API_KEY` never lends that key to an OpenAI candidate, and a missing candidate key is still an error. Both variables are rejected for `vertex` and `bedrock`, which sign in with cloud credentials. Only the `gemini` and `vertex` judges run with `temperature: 0`; current Claude and OpenAI reasoning models reject a non-default temperature. Claude judges run with `max_tokens: 16000` and `effort: "high"`: their thinking counts toward `max_tokens`, and Promptfoo's default of 2048 can end the reply before the verdict, which fails the case.

Keys stay in the process environment. Keep them out of YAML provider configuration because that configuration can be retained in exported results.

## Read the results

Every run gets its own directory under the ignored `evals/results/runs/`, so no run replaces another. The name starts with the UTC time and the commit, and says `dirty` when the working tree had changes: `2026-11-21T15-42-07Z-a5cd494-dirty-anthropic-default/`. It holds:

- `promptfoo.json`: Promptfoo's raw results.
- `summary.md`: the Markdown report.
- `score-<candidate>.json`: the pass count of every case for one candidate, plus the commit, a hash of the uncommitted diff, the judge, the Promptfoo version and a fingerprint of the suite files.
- `changes.patch`: the uncommitted diff the run measured, new files included. It is written only when the tree was dirty.
- `compare-<candidate>.md`: the comparison with the candidate's baseline, when one exists. The runner also prints it.

The Markdown report names the judge and groups pass rates by provider, language pair, category, difficulty, and tier, then lists individual failures and provider errors. Completed runs generate the report even below the pass-rate threshold and retain the failing exit code.

Use `npm run eval:results` for Promptfoo's viewer. Rebuild a summary with `npm run eval:report -- evals/results/runs/<run>/promptfoo.json`.

## Hill-climb a change

A committed baseline per candidate, `evals/baselines/<candidate>.json`, holds the score of the accepted state. Its schema is `ScoreSchema` in [`score.ts`](../evals/promptfoo/score.ts).

1. Record a starting baseline: run the suite with repeats, then `npm run eval:baseline`, and commit the file.
2. Change the prompt or the pipeline, then run with the same candidate and judge:
   ```bash
   npm run eval -- --model anthropic --judge anthropic/claude-sonnet-5-5 --repeat 3
   ```
   The run prints how each case moved against the baseline.
3. Keep the change: `npm run eval:baseline` and commit the baseline with the change in one commit. Drop it: revert the change; the run stays in `evals/results/runs/` as a record.

- `npm run eval:history` lists every run with its commit, judge, repeats, case count, pass rate and suite fingerprint, and marks the runs recorded as baselines. A `+` after the commit means the run had uncommitted changes, kept in its `changes.patch`.
- `npm run eval:compare` compares the latest run with the baselines; `npm run eval:compare -- <run> <other run>` compares two runs.
- `eval:baseline` takes the latest run, or the one you name. It refuses a run with provider errors, and a run whose commit plus uncommitted diff is not what the working tree holds now, so a baseline always describes the code it is committed with.

Compare runs only when the judge, the suite fingerprint and the Promptfoo version match; `eval:compare` warns on each mismatch. A single run is too noisy to compare: about a third of cases flip between two runs of the same code. Use `--repeat 3` or more, and read the per-case changes before the overall rate.

CI runs evals only when started by hand from the Actions tab (the Prompt Eval workflow); pull requests and pushes do not trigger it. A run covers the standard suite once per vendor (anthropic, gemini, openai) under the Claude Sonnet 5.5 judge, and uploads JSON and Markdown artifacts even when the evaluation fails. The anthropic leg is required, because its key also runs the judge; the other legs warn and skip when their key is not a repository secret.

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

Configuration policy lives in [`promptfooconfig.yaml`](../evals/promptfooconfig.yaml): threshold, backoff, concurrency, and sharing. `.env` holds run-specific credentials and server overrides. YAML-pinned environment values take precedence over `.env`.

Before submitting changes, run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run eval:validate`. Launcher regression tests use mocked HTTP and local echo-provider evaluations, so they need no live keys or paid calls.
