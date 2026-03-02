import { getPreferenceValues } from "@raycast/api";

export interface Language {
  code: string;
  name: string;
  nativeName: string;
}

export interface LanguagePair {
  source: Language;
  target: Language;
}

export const LANGUAGES: Language[] = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "uk", name: "Ukrainian", nativeName: "Українська" },
  { code: "pl", name: "Polish", nativeName: "Polski" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  { code: "cs", name: "Czech", nativeName: "Čeština" },
  { code: "sv", name: "Swedish", nativeName: "Svenska" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "zh", name: "Chinese", nativeName: "中文" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe" },
];

export function getLanguageByCode(code: string): Language | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

export function storageKeyPrefix(pair: LanguagePair): string {
  return `${pair.source.code}-${pair.target.code}`;
}

export function getLanguagePair(): LanguagePair {
  const { sourceLanguage = "en", targetLanguage = "uk" } = getPreferenceValues<Preferences>();
  const source = getLanguageByCode(sourceLanguage);
  const target = getLanguageByCode(targetLanguage);
  if (!source || !target) {
    throw new Error("Invalid language configuration in preferences.");
  }
  return { source, target };
}
