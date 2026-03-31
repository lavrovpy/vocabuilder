import { writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { Translation } from "./types";

function wordsOnly(translations: Translation[]): Translation[] {
  return translations.filter((t) => t.type === "word");
}

export function formatJson(translations: Translation[]): string {
  return JSON.stringify(translations, null, 2);
}

export function formatAnki(translations: Translation[]): string {
  const words = wordsOnly(translations);
  if (words.length === 0) return "";
  const header = "#separator:Tab\n#columns:Word\tTranslation\tPart of Speech\tExample\tExample Translation";
  const rows = words.map(
    (t) => `${t.word}\t${t.translation}\t${t.partOfSpeech}\t${t.example}\t${t.exampleTranslation}`,
  );
  return header + "\n" + rows.join("\n") + "\n";
}

export function formatQuizlet(translations: Translation[]): string {
  const words = wordsOnly(translations);
  if (words.length === 0) return "";
  return words.map((t) => `${t.word}\t${t.translation}`).join("\n") + "\n";
}

export function exportToFile(content: string, format: "json" | "anki" | "quizlet"): string {
  const date = new Date().toISOString().slice(0, 10);
  const ext = format === "json" ? "json" : "txt";
  const filename = `vocabuilder-${format}-${date}.${ext}`;
  const dir = join(homedir(), "Downloads");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const filePath = join(dir, filename);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}
