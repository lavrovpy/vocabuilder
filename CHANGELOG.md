VocaBuilder Changelog

## [Model, pronunciation, endpoint, and translate screen updates] - {PR_MERGE_DATE}

- Simplified translation and text-to-speech model preferences to accept any Gemini model ID without relying on hardcoded dropdown options.
- Removed the separate reasoning preference so reasoning behavior follows the configured model.
- Added a `Gemini API Server URL` preference so translation and pronunciation can be routed through any endpoint that speaks the native Gemini REST protocol, such as a proxy or gateway. Enter a bare server or gateway root; existing versioned and models-collection URLs are accepted too. Your API key is sent to the host you configure, so plain `http` is accepted only for local addresses and credential-bearing URLs are rejected.
- Reworked the translate screen while a translation is in progress: the word you are translating now appears as a row in the `Translation` section where its result will land, and your `Recent` translations stay on screen instead of the list clearing to an empty placeholder.
- Refreshed the extension icon.
- Tightened the pronunciation prompt for more accurate text-to-speech output.

## [Switch language pairs, pronunciation, and configurable models] - 2026-06-01

- Added an in-command language pair selector: switch the source and target language straight from a dropdown in the `Translate`, `Translation History`, and `View Flashcards` commands, without opening preferences. The selection persists across commands.
- Renamed the `Source Language` / `Target Language` preferences to `Default Source Language` / `Default Target Language` — they now apply until you pick a pair from the dropdown.
- Added `Translation Model` and `Text-to-Speech Model` preferences so you can point to a newer Gemini model if a default is deprecated.
- Reworked error handling into clearer, more consistent toasts, including deprecation-aware messages that tell you when a model is no longer available and how to switch.
- Added a target-language purity rule so translations stay in the chosen language, reducing cases where words from another language leak into the output.
- Reject non-existing/gibberish words instead of hallucinating translations.
- Require example sentences to contain the original word, not a synonym.
- Add post-validation that filters out senses with missing words in examples.
- Handle phrasal verbs and idioms (e.g. "give up", "break the ice") as single vocabulary items.

- Added word pronunciation via Gemini TTS (⌘O for source word, ⌘⇧O for translation).

## [Initial Release] - 2026-04-08

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
