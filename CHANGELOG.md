VocaBuilder Changelog

## [Harden word translation quality] - {PR_MERGE_DATE}

- Reject non-existing/gibberish words instead of hallucinating translations.
- Require example sentences to contain the original word, not a synonym.
- Add post-validation that filters out senses with missing words in examples.

## [Add word pronunciation] - {PR_MERGE_DATE}

- Added word pronunciation via Gemini TTS (⌘O for source word, ⌘⇧O for translation).

## [Initial Release] - {PR_MERGE_DATE}

- Added `Translate` command to translate words and short texts between languages using Gemini.
- Added `Translation History` command to browse saved translations.
- Added `Flashcards` command for spaced-repetition review of saved words (SM-2 algorithm).
- Added configurable source and target language support (17 languages).
- Added color-coded part-of-speech chips: nouns (blue), verbs (red), adjectives (green), adverbs (magenta), prepositions (yellow), pronouns (purple), conjunctions (orange).
- Added typo correction — misspelled words are auto-corrected before translation.
- Added short text and sentence translation support with detail panel.
- Added extension preferences for `Gemini API Key`, source/target language, and safe clipboard prefill behavior.
- Added auto-translate with 1.5s debounce for word input, manual submit for text.
- Added abort of in-flight requests on search text change.

<!-- Supported languages: English, Ukrainian, Russian, Belarusian, Polish, German, French, Spanish, Italian, Portuguese, Dutch, Czech, Swedish, Japanese, Korean, Chinese, Turkish -->
