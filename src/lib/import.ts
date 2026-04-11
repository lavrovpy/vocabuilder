import { readFile } from "fs/promises";
import { Translation } from "./types";

/**
 * Parse VocaBuilder's own Anki TSV export (5 columns with #separator/#columns headers)
 * or a plain Anki text export (2-column front/back TSV).
 */
export function parseAnkiTsv(content: string): Translation[] {
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  // Detect VocaBuilder header format
  let dataStart = 0;
  let columnMap: string[] | null = null;

  if (lines[0].startsWith("#separator:")) {
    dataStart++;
  }
  if (dataStart < lines.length && lines[dataStart].startsWith("#columns:")) {
    columnMap = lines[dataStart].replace("#columns:", "").split("\t");
    dataStart++;
  }

  // Skip any remaining comment lines
  while (dataStart < lines.length && lines[dataStart].startsWith("#")) {
    dataStart++;
  }

  const translations: Translation[] = [];
  const now = Date.now();

  for (let i = dataStart; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    if (cols.length < 2) continue;

    let word: string;
    let translation: string;
    let partOfSpeech = "";
    let example = "";
    let exampleTranslation = "";

    if (columnMap) {
      // Map columns by header name (VocaBuilder format)
      const colIndex = (name: string) => columnMap!.findIndex((c) => c.toLowerCase() === name.toLowerCase());
      word = cols[colIndex("Word")] ?? cols[0] ?? "";
      translation = cols[colIndex("Translation")] ?? cols[1] ?? "";
      partOfSpeech = cols[colIndex("Part of Speech")] ?? "";
      example = cols[colIndex("Example")] ?? "";
      exampleTranslation = cols[colIndex("Example Translation")] ?? "";
    } else {
      // Plain Anki 2+ column format: front = word, back = translation
      word = cols[0] ?? "";
      translation = cols[1] ?? "";
    }

    word = word.trim();
    translation = translation.trim();
    if (!word || !translation) continue;

    translations.push({
      id: `import-${word}-${now}-${i}`,
      word,
      translation,
      partOfSpeech: partOfSpeech.trim(),
      example: example.trim(),
      exampleTranslation: exampleTranslation.trim(),
      timestamp: now,
      type: "word",
    });
  }

  return translations;
}

/** Parse VocaBuilder JSON export (array of Translation objects). */
export function parseVocabuilderJson(content: string): Translation[] {
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed)) {
    throw new Error("Expected a JSON array of translations.");
  }

  const now = Date.now();
  return parsed
    .filter(
      (item: Record<string, unknown>) =>
        typeof item.word === "string" && typeof item.translation === "string" && item.word && item.translation,
    )
    .map((item: Record<string, unknown>, i: number) => ({
      id: `import-${item.word}-${now}-${i}`,
      word: String(item.word).trim(),
      translation: String(item.translation).trim(),
      partOfSpeech: typeof item.partOfSpeech === "string" ? item.partOfSpeech.trim() : "",
      example: typeof item.example === "string" ? item.example.trim() : "",
      exampleTranslation: typeof item.exampleTranslation === "string" ? item.exampleTranslation.trim() : "",
      timestamp: typeof item.timestamp === "number" ? item.timestamp : now,
      type: (item.type === "text" ? "text" : "word") as "word" | "text",
    }));
}

export type ImportFormat = "anki" | "json" | "auto";

/** Detect file format from content. */
export function detectFormat(content: string, filename?: string): "anki" | "json" {
  if (filename) {
    if (filename.endsWith(".json")) return "json";
    if (filename.endsWith(".txt") || filename.endsWith(".tsv")) return "anki";
  }
  const trimmed = content.trimStart();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return "json";
  return "anki";
}

/** Parse an import file, auto-detecting format if needed. */
export function parseImportContent(content: string, format: ImportFormat = "auto", filename?: string): Translation[] {
  const resolved = format === "auto" ? detectFormat(content, filename) : format;
  if (resolved === "json") {
    return parseVocabuilderJson(content);
  }
  return parseAnkiTsv(content);
}

/** Read a file from disk and parse it. */
export async function readAndParseImportFile(filePath: string, format: ImportFormat = "auto"): Promise<Translation[]> {
  const content = await readFile(filePath, "utf-8");
  const filename = filePath.split("/").pop();
  return parseImportContent(content, format, filename);
}
