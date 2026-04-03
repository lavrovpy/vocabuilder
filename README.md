# VocaBuilder

A [Raycast](https://raycast.com) extension that translates words and short text between languages via the Gemini AI API and saves a local translation history — helping you build vocabulary over time.

## Features

- **Translate words and text** — translate a single word with part of speech and example sentences, or translate short text directly
- **Multi-sense word translations** — for ambiguous words, review up to 5 senses and save the one you want to keep
- **Typo correction** — misspelled word input is auto-corrected before translating, with a visual indicator showing the original input
- **Translation History** — browse, search, and manage all your saved translations
- **Flashcards** — review saved word translations with spaced repetition
- **Configurable language pair** — pick source and target from 15 supported languages (defaults to English → Ukrainian)
- **Separate history per language pair** — switching languages gives you an independent history and flashcard deck
- **Clipboard suggestion** — optionally prefill a safe single word from the clipboard when the command opens
- **History export** — export saved history as JSON, Anki-ready TSV, or Quizlet-ready TSV
- Saves accepted translations to local history automatically
- Debounced word translation, with manual submit for text input
- Graceful error handling for API issues

## Setup

1. Get a free Gemini API key at [aistudio.google.com](https://aistudio.google.com)
2. Install the extension in Raycast dev mode:
   ```bash
   npm install
   npm run dev
   ```
3. Open Raycast → search **"Translate"** → enter your API key when prompted
4. (Optional) Open extension preferences to change source/target language or enable clipboard suggestions on open

## Commands

| Command | Description |
|---|---|
| Translate | Translate a word or text to your target language |
| Translation History | Browse saved translations |
| View Flashcards | Review saved words with spaced repetition |

## Supported Languages

English, Ukrainian, Polish, German, French, Spanish, Italian, Portuguese, Dutch, Czech, Swedish, Japanese, Korean, Chinese, Turkish

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `⌘ C` | Copy translation |
| `⌘ 1` → `⌘ 5` | Pick a word sense and save it to history |
| `⌘ ⇧ H` | Open History (from Translate) |
| `⌘ ⇧ T` | Toggle source and target languages |
| `⌘ D` | Delete entry (from History) |
| `⌘ ⇧ D` | Clear all history |
| `⌘ E` | Export history as JSON |
| `⌘ ⇧ A` | Export word history for Anki |
| `⌘ ⇧ Q` | Export word history for Quizlet |

## Stack

- [Raycast API](https://developers.raycast.com)
- TypeScript + React
- [Zod](https://zod.dev) for runtime validation
- Gemini `gemini-2.5-flash-lite` model
- npm

## License

MIT
