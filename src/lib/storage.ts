import { LocalStorage } from "@raycast/api";
import { z } from "zod";
import { Translation, TranslationSchema } from "./types";

const STORAGE_KEY = "vocabuilder-history";

export async function getHistory(): Promise<Translation[]> {
  const raw = await LocalStorage.getItem<string>(STORAGE_KEY);
  if (!raw) return [];
  try {
    return z.array(TranslationSchema).parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

export async function saveTranslation(t: Translation): Promise<void> {
  const history = await getHistory();
  const updated = [t, ...history.filter((h) => h.word !== t.word)];
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export async function deleteTranslation(id: string): Promise<void> {
  const history = await getHistory();
  const updated = history.filter((h) => h.id !== id);
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export async function clearHistory(): Promise<void> {
  await LocalStorage.removeItem(STORAGE_KEY);
}
