# Translation Evaluation Suite: Analysis and Design

Date: 2026-07-13

## Executive summary

The previous evaluation harness had a sound production-path provider but an undersized and highly concentrated dataset: 20 cases, of which 19 were English→Ukrainian and one was Ukrainian→English. It did not exercise 15 supported languages, used a random smoke sample, delegated deterministic application contracts to an LLM judge, and reported only Promptfoo's aggregate result.

The implemented design separates three jobs:

1. A stable 12-case smoke tier for fast developer feedback.
2. A 96-case risk-based suite for routine regression evaluation. It covers every supported non-English language in both directions through English, then adds deeper English↔Ukrainian and application-contract coverage.
3. An optional 272-case matrix with one uniform common-word probe for every directed pair among the 17 supported languages. This gives complete pair coverage without making all-pairs cost part of every routine run.

All cases call the production `translateWord` path. A deterministic assertion now grades mechanical application contracts, while a separate MQM-inspired LLM rubric grades meaning, target-language quality, and examples. A Markdown report breaks outcomes down by language pair, category, difficulty, and tier.

## Baseline findings

### What was already strong

- The custom provider calls `translateWord`, so the eval measures parsed, schema-validated, de-duplicated application behavior rather than raw model text.
- Provider configuration and YAML-sourced variables are validated with Zod.
- Outcome-domain errors are projected as application results, while infrastructure failures remain provider errors.
- The existing rubric explicitly treated source input, intent, expectations, and model output as untrusted.
- Suite-wide concurrency, backoff, sharing, and pass-rate settings had one source of truth.

These decisions were retained.

### Gaps in the previous suite

| Area | Previous state | Risk |
| --- | --- | --- |
| Dataset size | 20 cases | A few examples could dominate the score; regressions had little chance of matching a test. |
| Language coverage | 2 of 17 languages; 2 of 272 directed pairs | A high aggregate score said almost nothing about most configurations exposed by the UI. |
| Directionality | 95% English→Ukrainian | Source-language recognition and target-language generation were not independently exercised. |
| Difficulty balance | Mostly idioms and a handful of baselines | The suite did not systematically combine high-frequency vocabulary with difficult phenomena. |
| Smoke behavior | Random sample of 10 | Two runs could test different behavior, reducing reproducibility. |
| Contract grading | LLM judge interpreted `status`, `error`, `correctedWord`, and forbidden forms | Exact application contracts were subject to judge variance. |
| Reporting | Aggregate Promptfoo JSON/viewer | A weak language or category could hide behind the overall 75% threshold. |
| Maintainability | All cases inline in the main config | Adding breadth made the configuration harder to review and classify. |

## Research and design inputs

The implementation follows current primary guidance:

- [Promptfoo test-case documentation](https://www.promptfoo.dev/docs/configuration/test-cases/) recommends external test data, descriptive cases, and filterable metadata. It also supports dynamic JavaScript/TypeScript generation, used here to express systematic pair coverage without copy-pasting hundreds of rows.
- [Promptfoo's LLM-as-a-judge guide](https://www.promptfoo.dev/docs/guides/llm-as-a-judge/) recommends concrete binary criteria, separating dimensions, isolating untrusted candidate output, versioning the judge prompt, using a judge at least as capable as the system under test, and calibrating against human-labeled development and holdout sets.
- [Promptfoo JavaScript assertions](https://www.promptfoo.dev/docs/configuration/expected-outputs/javascript/) support reusable deterministic checks with component-level reasons. These now own contracts that do not require linguistic judgment.
- [Promptfoo output guidance](https://www.promptfoo.dev/docs/configuration/outputs/) documents structured JSON results and recommends automated summaries; the new report consumes that export.
- [MQM's translation error typology](https://themqm.org/error-types-2/typology/) separates accuracy, terminology, linguistic conventions, style, locale conventions, and audience appropriateness. The semantic rubric uses the dimensions relevant to a vocabulary application: accuracy/sense selection, misleading additions, target-language conventions, example fidelity, and learner usefulness.
- The `gemini-3.5-flash-extra-low` candidate and distinct `gemini-3.1-pro-low` semantic judge are both routed through the same local CLIProxyAPI Gemini-compatible endpoint. Keeping the judge distinct avoids using the same model as both candidate and grader. Product tier alone does not prove judge fitness; human agreement and holdout calibration remain required.

## Implemented suite architecture

### Layer 1: smoke

- 12 fixed cases.
- Covers Latin, Cyrillic, and CJK input.
- Includes both translation directions and several representative targets.
- Selected by `metadata.tier = smoke`, so the set is deterministic.
- Intended for prompt/provider iteration, not release confidence.

### Layer 2: standard risk-based suite

The standard suite contains 96 cases:

| Tier | Cases | Purpose |
| --- | ---: | --- |
| Smoke | 12 | Stable, fast multilingual signal. |
| Core | 24 | High-frequency and common vocabulary. |
| Challenge | 52 | Ambiguity, idioms, false friends, lexical gaps, particles, register, kinship, and language purity. |
| Contract | 8 | Typo correction, gibberish rejection, Unicode rejection, and input-boundary behavior. |

Difficulty distribution:

| Difficulty | Cases |
| --- | ---: |
| Easy | 38 |
| Medium | 7 |
| Hard | 51 |

The apparent hard-case majority is intentional: every language receives basic coverage, while extra budget targets failures that ordinary dictionary-like words do not expose.

Pair allocation:

- Every non-English language has at least two English→language cases and two language→English cases.
- English→Ukrainian has 28 cases because it is the default and historically highest-risk path.
- Ukrainian→English has 8 cases.
- The remaining 30 English-pivot directions have two cases each.

This yields 32 directed pairs in the routine suite. English is used as the pivot because 2 × (17 − 1) gives bidirectional evidence for every language at linear cost. It is not treated as complete pair coverage; that is the matrix tier's job.

### Layer 3: exhaustive pair matrix

The optional matrix contains all 17 × 16 = 272 directed pairs. Each source language uses its standard word for “water,” translated to every other target language. A uniform concrete concept was selected because it is:

- high frequency;
- culturally and semantically stable;
- available in every supported language;
- valid for the application's vocabulary-input boundary;
- useful for catching source-language misidentification, script handling, related-language drift, and target-language generation failures.

The matrix is deliberately separate from the routine 96-case suite. It is broad rather than deep and requires 272 candidate calls plus 272 judge calls. It should run before releases, after model or prompt changes, or on a schedule—not on every edit.

## Case taxonomy

The standard dataset uses reviewable metadata rather than a flat list:

| Category | Examples of what it tests |
| --- | --- |
| `common` | hello, water, family, book, home, high-frequency verbs |
| `polysemy` | bank, light, fair, charge, match, set, mean |
| `idiom` | red herring, kick the bucket, ні пуху ні пера |
| `phrasal-verb` | give up, break down, look up, make up |
| `false-friend` | eventually→Polish, become→German, actually→French, embarrassed→Spanish |
| `lexical-gap` | Schadenfreude, sobremesa, saudade, gezellig, lagom, 눈치 |
| `particle` | magari, авось, таки |
| `kinship` / `register` | Chinese uncle distinctions; Turkish informal/formal “you” |
| `language-purity` | English→Belarusian without Russian substitution |
| `typo` | word and idiom correction in Latin and Cyrillic scripts |
| `rejection` / `input-validation` | random Latin/Cyrillic strings and an alphanumeric boundary failure |

Cases include an intent instead of a single exact reference translation. Exact-match scoring is too brittle for synonymy, inflection, regional variants, and legitimate multi-sense answers. Exact negative forms are used only for known false friends or literal idiom failures.

## Grading design

### Deterministic application contract

`assert-output.cjs` parses the provider projection and checks:

- exact input and language-pair preservation;
- expected success/error status and outcome error code;
- one to five complete senses for successful results;
- unique translation + part-of-speech identities;
- exact `correctedWord` behavior, including no spurious correction;
- exact source or corrected form in every source-language example;
- explicitly forbidden known-wrong translations.

This produces component-level failure reasons and does not spend judge capacity on facts code can determine exactly.

### Semantic translation quality

The LLM judge grades only what needs linguistic judgment:

1. Meaning and intended sense coverage.
2. No false friends, literal idiom renderings, invented meanings, or misleading extra senses.
3. Standard target-language grammar, orthography, morphology, register, and language purity.
4. Natural paired examples that express the same listed sense.
5. Learner-useful part-of-speech choices and ordering.

The judge produces one overall binary verdict, not five independently averaged dimension scores. Any applicable criterion failing makes the row fail. It must name the decisive evidence in one sentence. Candidate output and all case variables are wrapped as untrusted data in a separate, versioned judge prompt.

Using one semantic judge call for five tightly related translation criteria is a deliberate cost/latency compromise, especially for the 272-row matrix. Promptfoo's guidance notes that single-dimension judges are generally more consistent. Human calibration should therefore measure dimension-specific disagreements; any unstable criterion should be split into its own named judge assertion for the standard suite before increasing release reliance on the score.

### Comparison normalization

The deterministic assertion uses intentionally different comparison rules for different contracts:

- Sense identity and forbidden translations use Unicode NFKC normalization, trim outer whitespace, and lowercase before comparison. Forbidden forms are checked as substrings across all returned glosses. Punctuation and diacritics are otherwise preserved.
- `input`, language codes, expected errors, and `correctedWord` use exact JavaScript string equality.
- The source-form example rule uses an exact, case-sensitive, code-point substring check for the original input or expected correction. It does not stem, lemmatize, fold case, or normalize whitespace.

That last rule can be stricter than general translation evaluation for inflected languages. It is retained because it is an explicit production prompt/application contract, and cases use source forms that can appear naturally unchanged in a sentence. If product behavior later allows inflected source examples, the production prompt, assertion, and eval cases must change together rather than silently weakening only the test.

## Reporting and commands

`report.ts` converts Promptfoo JSON into Markdown tables for:

- language pair;
- category;
- difficulty;
- tier;
- individual failures and provider errors.

Likely API-key patterns are redacted from recorded failure reasons before the Markdown file is written.

| Command | Scope | Output |
| --- | --- | --- |
| `npm run eval:validate` | Configuration only; no Gemini calls | Console validation |
| `npm run eval:smoke` | 12 fixed cases | `promptfoo-smoke.json`, `summary-smoke.md` |
| `npm run eval` | 96 risk-based cases | `promptfoo.json`, `summary.md` |
| `npm run eval:matrix` | 272 directed pairs | `promptfoo-matrix.json`, `summary-matrix.md` |
| `npm run eval:all` | All 368 cases | `promptfoo-all.json`, `summary-all.md` |
| `npm run eval:results` | Local Promptfoo viewer | Interactive UI |

The existing 75% aggregate threshold remains unchanged because model-graded and provider-service flakes still exist and the project has not yet collected enough repeated-run variance to set a defensible tighter gate. This is a permissive compatibility gate: it allows up to 24 unsuccessful rows in the 96-case suite, 68 in the 272-case matrix, or 92 in the combined 368-case run. It is therefore not sufficient release evidence by itself.

Until calibrated subgroup gates are implemented, the review rule is explicit and manual: investigate every zero-pass pair and every category, language pair, difficulty, or tier below the 75% overall threshold. Record whether the cause is a candidate regression, judge disagreement, or provider error. Tightening the automated gate requires repeated-run data, not an arbitrary replacement percentage.

## Verification and maintenance rules

Automated tests enforce the suite's structural contracts:

- exactly 96 standard and 272 matrix cases;
- unique stable case IDs;
- exact agreement with the app's supported language codes and names;
- at least two routine cases in both English-pivot directions for every language;
- all 272 ordered pairs in the matrix;
- a fixed 12-case smoke tier spanning multiple scripts;
- Unicode-aware application-valid inputs except the explicit invalid-input case;
- deterministic assertion behavior for successes, errors, corrections, forbidden forms, duplicates, and example-source fidelity.

When adding a supported language, the suite test should fail until both its risk-based cases and matrix source word are supplied. When adding a new application behavior, add or update its eval case and deterministic assertion in the same change.

## Known limitations and next steps

1. **Human calibration is still required.** The rubric should be calibrated against 30–50 human-labeled candidate outputs, with a separate holdout set and native-speaker review. Those labels should not be fabricated from the same model being evaluated.
2. **The matrix is intentionally shallow.** A passing water translation does not establish idiom or morphology quality for that pair; it establishes basic pair viability.
3. **Non-English↔non-English pairs are absent from the standard suite.** They are covered only by explicit matrix/all runs. Promote real matrix failures into focused standard regression cases.
4. **The harness evaluates word/short-expression translation, not `translateText`.** This matches the existing production eval target and the vocabulary-focused brief. Sentence/document evaluation should be a separate provider and dataset because its contracts and error taxonomy differ.
5. **The judge is a pinned CLIProxyAPI model alias.** Review the alias when the proxy's available models change. Another judge may be used for development only after measured agreement with the calibrated judge.
6. **Aggregate gating is insufficient by itself.** Once enough repeated results exist, add explicit minimums for critical categories and languages using historical variance rather than arbitrary thresholds.

## Implementation and verification status

Structurally implemented and verified on 2026-07-13:

- `npm test`: 25 files and 304 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: Raycast metadata, ESLint, and Prettier checks passed.
- `npm run build`: Raycast extension build passed.
- `npm run eval:validate`: Promptfoo configuration passed without Gemini calls.

The smoke suite was exercised end to end through CLIProxyAPI on 2026-08-01 and completed at the configured 75% threshold with zero provider errors. The standard, matrix, and all live evaluations were not run because the combined run requires 736 candidate/judge calls through the local proxy. The suite is structurally implemented; it is not yet linguistically accepted until the broader live runs and human calibration are completed.

## Acceptance criteria

The design is successful when:

- configuration validation and project tests pass;
- smoke runs select the same 12 case IDs every time;
- every zero-pass pair and every reported subgroup below 75% is investigated and classified until calibrated subgroup gates replace this manual rule;
- matrix runs cover all 272 pairs without unsupported codes or invalid inputs;
- judge agreement exceeds 90% on a human-labeled development set and remains comparable on holdout data;
- model or prompt regressions can be traced to a pair, category, difficulty, and concrete failure reason.

## Appendix: supported languages and matrix probes

The matrix uses these code/name/source-form records. Automated tests verify that the codes and names match the application's `LANGUAGES` registry, that every form passes the Unicode-aware vocabulary-input boundary, and that all 272 ordered pairs are generated. Linguistic sign-off on the curated forms remains part of native-speaker calibration.

| Code | Language | Source form for “water” |
| --- | --- | --- |
| `en` | English | water |
| `uk` | Ukrainian | вода |
| `ru` | Russian | вода |
| `be` | Belarusian | вада |
| `pl` | Polish | woda |
| `de` | German | Wasser |
| `fr` | French | eau |
| `es` | Spanish | agua |
| `it` | Italian | acqua |
| `pt` | Portuguese | água |
| `nl` | Dutch | water |
| `cs` | Czech | voda |
| `sv` | Swedish | vatten |
| `ja` | Japanese | 水 |
| `ko` | Korean | 물 |
| `zh` | Chinese | 水 |
| `tr` | Turkish | su |
