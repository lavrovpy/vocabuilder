# VocaBuilder

A [Raycast](https://raycast.com) extension that translates words and short text between languages via the Gemini AI API and saves a local translation history — helping you build vocabulary over time.

## Features

- **Translate words and text** — translate a single word with part of speech and example sentences, or translate short text directly
- **Multi-sense word translations** — for ambiguous words, review up to 5 senses and save the one you want to keep
- **Word pronunciation** — hear the source word or its translation spoken aloud via a configurable Gemini text-to-speech model
- **Typo correction** — misspelled word input is auto-corrected before translating, with a visual indicator showing the original input
- **Translation History** — accepted translations are saved automatically; browse, search, and manage them anytime
- **View Flashcards** — review saved word translations with spaced repetition
- **Configurable language pair** — pick source and target from 17 supported languages (defaults to English → Ukrainian), switchable from a dropdown inside each command or via preferences
- **Configurable models** — paste the Gemini model IDs used for translation and text-to-speech without waiting for a hardcoded model list to be updated
- **Custom API endpoint** — route translation and pronunciation through any endpoint that speaks the native Gemini REST protocol using its bare server or gateway URL; versioned and models-collection URLs are also accepted, and your API key is sent to whichever host you configure, so plain `http` is limited to local addresses
- **Separate history per language pair** — switching languages gives you an independent history and flashcard deck
- **Clipboard suggestion** — optionally prefill a safe single word from the clipboard when the command opens
- **History export** — export saved history as JSON, Anki-ready TSV, or Quizlet-ready TSV
- Debounced word translation, with manual submit for text input
- Graceful error handling for API issues

## Getting Started

1. Get a free Gemini API key at [aistudio.google.com](https://aistudio.google.com).
2. Run the **Translate** command and paste your API key when prompted.
3. (Optional) Open the extension preferences to set default languages, paste the Gemini translation and speech model IDs you want to use, or enable clipboard suggestions on open.

## Commands

| Command | Description |
| --- | --- |
| Translate | Translate a word or short text |
| Translation History | Open your saved translations |
| View Flashcards | Review words you've saved |

## Supported Languages

English, Ukrainian, Polish, German, French, Spanish, Italian, Portuguese, Dutch, Czech, Swedish, Japanese, Korean, Chinese, Turkish, Russian, Belarusian

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘ C` | Copy translation |
| `⌘ O` | Pronounce source word |
| `⌘ ⇧ O` | Pronounce translation |
| `⌘ 1` → `⌘ 5` | Pick a word sense and save it to history |
| `⌘ ⇧ H` | Open History (from Translate) |
| `⌘ ⇧ T` | Toggle source and target languages |
| `⌘ D` | Delete entry (from History) |
| `⌘ ⇧ D` | Clear all history |
| `⌘ E` | Export history as JSON |
| `⌘ ⇧ A` | Export word history for Anki |
| `⌘ ⇧ Q` | Export word history for Quizlet |

## Development

Use the Node version pinned in [`.nvmrc`](.nvmrc) — **Node 22.22.2**, which bundles **npm 10.9.7** and matches the current Raycast extension toolchain. Then run the extension in Raycast dev mode:

```bash
nvm use        # Node 22.22.2 / npm 10.9.7
npm install
npm run dev
```

> Regenerate `package-lock.json` only on npm 10.x. npm 11 records optional peer dependencies differently, producing a lockfile that passes locally but fails the store CI's `npm ci`.

Built with the [Raycast API](https://developers.raycast.com), TypeScript + React, and [Zod](https://zod.dev) for runtime validation. Translations use Gemini — defaults `gemini-3.5-flash` (text) and `gemini-3.1-flash-tts-preview` (speech), configurable in preferences.

## Translation evaluations

The production `translateWord` path is evaluated with a 96-case risk-based Promptfoo suite plus an optional 272-case matrix covering every directed language pair. The standard suite covers all 17 supported languages, common vocabulary, ambiguity, idioms, phrasal verbs, lexical gaps, false friends, typo correction, and rejection behavior. Results include a Markdown breakdown by language pair, category, difficulty, and tier.

Live evals configure the production translation target and semantic judge independently. Copy `.env.example` to `.env` and set the six required role-based variables:

```dotenv
EVAL_TRANSLATION_API_KEY=
EVAL_TRANSLATION_API_BASE_URL=http://127.0.0.1:8317
EVAL_TRANSLATION_MODEL=gemini-3.5-flash-extra-low

EVAL_JUDGE_API_KEY=
EVAL_JUDGE_API_BASE_URL=http://127.0.0.1:8317
EVAL_JUDGE_PROVIDER_ID=google:gemini-3.1-pro-low
```

The judge value is a complete Promptfoo provider ID, so switching to another provider is atomic—for example, `openai:responses:gpt-5`. The eval runner securely maps `EVAL_JUDGE_API_KEY` to Promptfoo's native credential variable for key-based Google, OpenAI, and Anthropic judges without serializing the secret into result artifacts. The two roles may currently use the same CLIProxyAPI client key and URL, but neither falls back to the other's configuration.

```bash
npm run eval:validate # validate configuration without model calls
npm run eval:smoke    # stable 12-case developer check
npm run eval          # 96-case risk-based suite plus summary
npm run eval:matrix   # every directed pair; 272 model-graded cases
npm run eval:all      # both suites; 368 cases and intentionally expensive
```

See [the evaluation-suite design](docs/evaluation-suite-design.md) for coverage, grading, reporting, and maintenance decisions.

## License

MIT
