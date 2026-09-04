import { Translation } from "./types";

function escapeMarkdown(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/[\\`*_{}[\]()#+.!|>~-]/g, "\\$&")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeMarkdownMultiline(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => escapeMarkdown(line))
    .join("  \n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Most precise match first: the exact form, then an inflected form sharing the
// stem ("cat" in "cats"), then a bare substring for scripts without word
// boundaries (CJK). Boundaries are \p{L}\p{N} lookarounds, not \b, so Cyrillic
// and other non-ASCII letters count as word characters.
function findWordPattern(line: string, word: string): RegExp | null {
  const escaped = escapeRegExp(word.trim());
  if (!escaped) return null;
  const candidates = [
    new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"),
    new RegExp(`(?<![\\p{L}\\p{N}])${escaped}[\\p{L}\\p{N}]*`, "giu"),
    new RegExp(escaped, "giu"),
  ];
  return candidates.find((pattern) => line.search(pattern) !== -1) ?? null;
}

function emphasizeWord(line: string, word: string): string {
  const pattern = findWordPattern(line, word);
  if (!pattern) return escapeMarkdown(line);
  let out = "";
  let last = 0;
  for (const match of line.matchAll(pattern)) {
    out += `${escapeMarkdown(line.slice(last, match.index))}**${escapeMarkdown(match[0])}**`;
    last = match.index + match[0].length;
  }
  return out + escapeMarkdown(line.slice(last));
}

function emphasizeWordMultiline(value: string, word: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => emphasizeWord(line, word))
    .join("  \n");
}

const ENTRY_SEPARATOR = " · ";

type EntryLine = Pick<Translation, "word" | "partOfSpeech" | "transcription" | "forms" | "register">;

function collapseWhitespace(value: string | undefined): string {
  // Collapsed, not just trimmed: a newline anywhere in a model-supplied field
  // would otherwise split the entry line into two paragraphs.
  return value?.replace(/\s+/gu, " ").trim() ?? "";
}

// Everything grammatical about the lookup on one line: the source word with its
// transcription, then part of speech, inflections and register. Segments are
// collected and then joined, rather than concatenated with separators inline,
// because Gemini omits any of them — an inline join is what leaves a dangling
// "·" or a lone "/…/" on the line.
//
// Word and transcription are one segment, not two, because a dictionary sets
// them adjacently ("cat /kæt/") rather than as peers of the grammar that
// follows. The word is bold for the same reason it is bold inside the example
// sentence: it is the thing looked up. The transcription stays upright and
// keeps its slashes — italic distorts IPA glyphs — so the italic is spent on
// `register`, the one segment that is a usage caveat rather than a grammatical
// fact.
//
// The line is returned bare; `buildApparatus` is what quotes it.
function buildEntryLine(entry: EntryLine): string {
  const word = collapseWhitespace(entry.word);
  const transcription = collapseWhitespace(entry.transcription);
  const lemma = [word ? `**${escapeMarkdown(word)}**` : "", transcription ? `/${escapeMarkdown(transcription)}/` : ""]
    .filter(Boolean)
    .join(" ");
  const segments = [lemma];
  const push = (value: string | undefined, wrap: (escaped: string) => string) => {
    const collapsed = collapseWhitespace(value);
    if (collapsed) segments.push(wrap(escapeMarkdown(collapsed)));
  };
  push(entry.partOfSpeech, (s) => s);
  push(entry.forms, (s) => s);
  push(entry.register, (s) => `*${s}*`);
  return segments.filter(Boolean).join(ENTRY_SEPARATOR);
}

// Entry line and correction notice are both editorial apparatus about the
// lookup rather than the answer to it, so they share one blockquote: markdown
// offers only bold and italic, both already spent elsewhere, and the quote rule
// is the one remaining way to set apparatus below body text. Two separate
// quotes would render as two stacked rules reading as unrelated asides.
function buildApparatus(lines: string[]): string {
  const present = lines.filter(Boolean);
  if (present.length === 0) return "";
  return present.map((line) => `> ${line}`).join("  \n");
}

// The gloss is the heading, not the source word. A monolingual dictionary sets
// the headword largest because that is what you scan a page for, but here the
// source word was just typed by the user and is echoed in the search bar and the
// list beside this pane — the gloss is the only new information in the view.
export function buildTranslationDetailMarkdown(
  translation: Pick<
    Translation,
    "word" | "translation" | "partOfSpeech" | "example" | "exampleTranslation" | "transcription" | "forms" | "register"
  >,
  originalInput?: string,
): string {
  const apparatus = buildApparatus([
    buildEntryLine(translation),
    originalInput && originalInput !== translation.word ? `*Corrected from "${escapeMarkdown(originalInput)}"*` : "",
  ]);
  const blocks = [
    `# ${escapeMarkdown(translation.translation)}`,
    apparatus,
    "---",
    emphasizeWordMultiline(translation.exampleTranslation, translation.word),
    `*${escapeMarkdownMultiline(translation.example)}*`,
  ];
  return blocks.filter(Boolean).join("\n\n");
}

export function buildTextTranslationDetailMarkdown(input: string, translation: string): string {
  return `## Translation

${escapeMarkdownMultiline(translation)}

---

## Original

${escapeMarkdownMultiline(input)}`;
}

export function buildFlashcardDetailMarkdown(
  card: Pick<Translation, "word" | "translation" | "partOfSpeech" | "example" | "exampleTranslation">,
): string {
  return `## ${escapeMarkdown(card.word)}${posChip(card.partOfSpeech)}

**${escapeMarkdown(card.translation)}**

${emphasizeWordMultiline(card.exampleTranslation, card.word)}

*${escapeMarkdownMultiline(card.example)}*`;
}

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  const word = {
    word: "rapture",
    translation: "захоплення",
    partOfSpeech: "noun",
    example: "Вона слухала його виступ із невимовним захопленням.",
    exampleTranslation: "She listened to his speech with unspoken rapture.",
  };

  describe("posChip", () => {
    it("rides the headline beside the word rather than the metadata rail", () => {
      const [headline] = buildTranslationDetailMarkdown(word).split("\n");
      expect(headline).toBe("## rapture `noun`");
    });

    it("leaves the headline bare when the model returns no part of speech", () => {
      expect(buildTranslationDetailMarkdown({ ...word, partOfSpeech: "  " }).split("\n")[0]).toBe("## rapture");
    });

    it("strips backticks so model output cannot break out of the code span", () => {
      const [headline] = buildTranslationDetailMarkdown({ ...word, partOfSpeech: "no`un` **bold**" }).split("\n");
      expect(headline).toBe("## rapture `no un  **bold**`");
      expect(headline.match(/`/g)).toHaveLength(2);
    });

    it("chips the flashcard headline the same way", () => {
      expect(buildFlashcardDetailMarkdown(word).split("\n")[0]).toBe("## rapture `noun`");
    });
  });
}
