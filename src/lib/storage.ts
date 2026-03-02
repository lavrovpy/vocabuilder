import { LocalStorage } from "@raycast/api";
import { z } from "zod";
import {
  FlashcardProgress,
  FlashcardProgressSchema,
  Translation,
  TranslationSchema,
} from "./types";
import { LanguagePair, storageKeyPrefix } from "./languages";

const LEGACY_HISTORY_KEY = "vocabuilder-history";
const LEGACY_FLASHCARD_KEY = "vocabuilder-flashcards";

function historyKey(pair: LanguagePair): string {
  return `vocabuilder-history-${storageKeyPrefix(pair)}`;
}

function historyCorruptBackupKey(pair: LanguagePair): string {
  return `${historyKey(pair)}-corrupt-backup`;
}

function flashcardKey(pair: LanguagePair): string {
  return `vocabuilder-flashcards-${storageKeyPrefix(pair)}`;
}

function flashcardCorruptBackupKey(pair: LanguagePair): string {
  return `${flashcardKey(pair)}-corrupt-backup`;
}

async function migrateIfNeeded(
  legacyKey: string,
  newKey: string,
): Promise<void> {
  const existing = await LocalStorage.getItem<string>(newKey);
  if (existing) return;

  const legacy = await LocalStorage.getItem<string>(legacyKey);
  if (!legacy) return;

  await LocalStorage.setItem(newKey, legacy);
}

function isEnUkPair(pair: LanguagePair): boolean {
  return pair.source.code === "en" && pair.target.code === "uk";
}

async function ensureMigrated(pair: LanguagePair): Promise<void> {
  if (!isEnUkPair(pair)) return;
  await Promise.all([
    migrateIfNeeded(LEGACY_HISTORY_KEY, historyKey(pair)),
    migrateIfNeeded(LEGACY_FLASHCARD_KEY, flashcardKey(pair)),
  ]);
}

async function backupCorruptedStorage(
  sourceKey: string,
  backupKey: string,
  raw: string,
  error: unknown,
): Promise<void> {
  const existingBackup = await LocalStorage.getItem<string>(backupKey);
  if (!existingBackup) {
    await LocalStorage.setItem(backupKey, raw);
  }
  console.error(
    `[storage] Corrupted data detected for "${sourceKey}". Refusing to overwrite existing data.`,
    error,
  );
}

async function parseStoredArray<T>(
  sourceKey: string,
  backupKey: string,
  raw: string,
  schema: z.ZodType<T[]>,
): Promise<T[] | null> {
  try {
    return schema.parse(JSON.parse(raw));
  } catch (error) {
    await backupCorruptedStorage(sourceKey, backupKey, raw, error);
    return null;
  }
}

export async function getHistory(pair: LanguagePair): Promise<Translation[]> {
  await ensureMigrated(pair);
  const key = historyKey(pair);
  const raw = await LocalStorage.getItem<string>(key);
  if (!raw) return [];
  const parsed = await parseStoredArray(
    key,
    historyCorruptBackupKey(pair),
    raw,
    z.array(TranslationSchema),
  );
  return parsed ?? [];
}

export async function saveTranslation(
  t: Translation,
  pair: LanguagePair,
): Promise<boolean> {
  await ensureMigrated(pair);
  const key = historyKey(pair);
  const raw = await LocalStorage.getItem<string>(key);
  const history = raw
    ? await parseStoredArray(
        key,
        historyCorruptBackupKey(pair),
        raw,
        z.array(TranslationSchema),
      )
    : [];
  if (!history) return false;

  const updated = [t, ...history.filter((h) => h.word !== t.word)];
  await LocalStorage.setItem(key, JSON.stringify(updated));
  return true;
}

export async function deleteTranslation(
  id: string,
  pair: LanguagePair,
): Promise<boolean> {
  await ensureMigrated(pair);
  const key = historyKey(pair);
  const raw = await LocalStorage.getItem<string>(key);
  const history = raw
    ? await parseStoredArray(
        key,
        historyCorruptBackupKey(pair),
        raw,
        z.array(TranslationSchema),
      )
    : [];
  if (!history) return false;

  const updated = history.filter((h) => h.id !== id);
  await LocalStorage.setItem(key, JSON.stringify(updated));
  return true;
}

export async function clearHistory(pair: LanguagePair): Promise<void> {
  await LocalStorage.removeItem(historyKey(pair));
}

async function getFlashcardProgress(
  pair: LanguagePair,
): Promise<Map<string, FlashcardProgress>> {
  await ensureMigrated(pair);
  const key = flashcardKey(pair);
  const raw = await LocalStorage.getItem<string>(key);
  if (!raw) return new Map();
  const arr = await parseStoredArray(
    key,
    flashcardCorruptBackupKey(pair),
    raw,
    z.array(FlashcardProgressSchema),
  );
  return new Map((arr ?? []).map((p) => [p.word, p]));
}

export async function saveFlashcardProgress(
  progress: FlashcardProgress,
  pair: LanguagePair,
): Promise<boolean> {
  await ensureMigrated(pair);
  const key = flashcardKey(pair);
  const raw = await LocalStorage.getItem<string>(key);
  const arr = raw
    ? await parseStoredArray(
        key,
        flashcardCorruptBackupKey(pair),
        raw,
        z.array(FlashcardProgressSchema),
      )
    : [];
  if (!arr) return false;

  const map = new Map(arr.map((p) => [p.word, p]));
  map.set(progress.word, progress);
  await LocalStorage.setItem(key, JSON.stringify([...map.values()]));
  return true;
}

interface SessionData {
  sessionCards: Translation[];
  progressMap: Map<string, FlashcardProgress>;
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export async function getSessionCards(
  pair: LanguagePair,
): Promise<SessionData> {
  const [history, progressMap] = await Promise.all([
    getHistory(pair),
    getFlashcardProgress(pair),
  ]);
  const now = Date.now();

  const due = history
    .filter((t) => {
      const p = progressMap.get(t.word);
      return p !== undefined && p.nextReviewDate <= now;
    })
    .sort((a, b) => {
      const pa = progressMap.get(a.word)!;
      const pb = progressMap.get(b.word)!;
      return pa.nextReviewDate - pb.nextReviewDate;
    });

  const unseen = history.filter((t) => !progressMap.has(t.word));

  const sessionCards = shuffle([...due, ...unseen].slice(0, 10));
  return { sessionCards, progressMap };
}
