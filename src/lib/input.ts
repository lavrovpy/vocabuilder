export const MAX_VOCAB_LENGTH = 50;
export const MAX_PHRASE_TOKENS = 5;

const TOKEN = String.raw`[\p{L}]+(?:['-][\p{L}]+)?`;
const VOCAB_INPUT_RE = new RegExp(`^${TOKEN}(?:\\s+${TOKEN}){0,${MAX_PHRASE_TOKENS - 1}}$`, "u");

export function normalizeWordInput(raw: string): string | null {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (!collapsed || collapsed.length > MAX_VOCAB_LENGTH) return null;
  if (!VOCAB_INPUT_RE.test(collapsed)) return null;
  return collapsed;
}

export const MAX_TEXT_LENGTH = 2000;

export function normalizeTextInput(raw: string): string | null {
  const text = raw.trim();
  if (!text || text.length > MAX_TEXT_LENGTH) return null;
  return text;
}

export function asJsonStringLiteral(value: string): string {
  return JSON.stringify(value);
}
