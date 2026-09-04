import { Translation } from "./types";

export const TTS_HINT_TEXT = "⌘O to pronounce · ⌘⇧O for translation";

// The hint lives inside the markdown rather than in `List.Item.Detail.Metadata`:
// a metadata block makes Raycast split the pane at a fixed ratio and the
// markdown region above it clips long example sentences.
export function withTtsHint(markdown: string): string {
  return `${markdown}

---

*🔊 ${TTS_HINT_TEXT}*`;
}

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

const HEADWORD_SEPARATOR = " · ";

type HeadwordEntry = Pick<Translation, "partOfSpeech" | "transcription" | "forms" | "register">;

// The grammar line of a print dictionary entry: transcription, part of speech,
// inflections, register. Segments are collected and then joined, rather than
// concatenated with separators inline, because Gemini omits any of them — an
// inline join is what leaves a dangling "·" or a lone "/…/" on the line.
//
// The transcription stays upright and keeps its slashes: italic distorts IPA
// glyphs, and no dictionary sets phonetics in italic. The italic is spent on
// `register` instead — the one segment that is a usage caveat rather than a
// grammatical fact, and so the one worth telling apart at a glance.
function buildHeadwordLine(entry: HeadwordEntry): string {
  const segments: string[] = [];
  const push = (value: string | undefined, wrap: (escaped: string) => string) => {
    // Whitespace is collapsed, not just trimmed: a newline anywhere in a
    // model-supplied field would otherwise split the headword line in two.
    const collapsed = value?.replace(/\s+/gu, " ").trim();
    if (collapsed) segments.push(wrap(escapeMarkdown(collapsed)));
  };
  push(entry.transcription, (s) => `/${s}/`);
  push(entry.partOfSpeech, (s) => s);
  push(entry.forms, (s) => s);
  push(entry.register, (s) => `*${s}*`);
  return segments.join(HEADWORD_SEPARATOR);
}

export function buildTranslationDetailMarkdown(
  translation: Pick<
    Translation,
    "word" | "translation" | "partOfSpeech" | "example" | "exampleTranslation" | "transcription" | "forms" | "register"
  >,
  originalInput?: string,
): string {
  const headwordLine = buildHeadwordLine(translation);
  const headword = `# ${escapeMarkdown(translation.word)}`;
  const blocks = [
    headwordLine ? `${headword}\n${headwordLine}` : headword,
    originalInput && originalInput !== translation.word ? `> *Corrected from "${escapeMarkdown(originalInput)}"*` : "",
    `**${escapeMarkdown(translation.translation)}**`,
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
  return `## ${escapeMarkdown(card.word)}

**${escapeMarkdown(card.partOfSpeech)}** · ${escapeMarkdown(card.translation)}

---

${emphasizeWordMultiline(card.exampleTranslation, card.word)}

*${escapeMarkdownMultiline(card.example)}*`;
}
