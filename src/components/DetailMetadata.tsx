import { Icon, List } from "@raycast/api";
import type { Keyboard } from "@raycast/api";
import { LanguagePair } from "../lib/languages";
import { SHORTCUTS, formatShortcut } from "../lib/shortcuts";
import { isTtsSupported } from "../lib/tts";

interface PronounceRow {
  title: string;
  shortcut: { modifiers: Keyboard.KeyModifier[]; key: Keyboard.KeyEquivalent };
}

// Mirrors the guard inside PronounceAction, which renders nothing for a language
// Gemini TTS does not speak. A rail row without an action behind it is a lie.
function pronounceRows(languagePair: LanguagePair, sourceTitle: string): PronounceRow[] {
  const rows: PronounceRow[] = [];
  if (isTtsSupported(languagePair.source.code)) {
    rows.push({ title: sourceTitle, shortcut: SHORTCUTS.pronounceWord });
  }
  if (isTtsSupported(languagePair.target.code)) {
    rows.push({ title: "Pronounce Translation", shortcut: SHORTCUTS.pronounceTranslation });
  }
  return rows;
}

interface DetailMetadataProps {
  languagePair: LanguagePair;
  sourceTitle?: string;
}

// Raycast splits the detail pane once a metadata block exists. The markdown body
// above it stays the dictionary entry; only the pronunciation rows live here.
export function DetailMetadata({ languagePair, sourceTitle = "Pronounce Word" }: DetailMetadataProps) {
  const rows = pronounceRows(languagePair, sourceTitle);
  if (rows.length === 0) return null;

  return (
    <List.Item.Detail.Metadata>
      {rows.map((row) => (
        <List.Item.Detail.Metadata.Label
          key={row.title}
          title={row.title}
          icon={Icon.SpeakerHigh}
          text={formatShortcut(row.shortcut)}
        />
      ))}
    </List.Item.Detail.Metadata>
  );
}

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  const pair = (source: string, target: string): LanguagePair => ({
    source: { code: source, name: source },
    target: { code: target, name: target },
  });

  describe("pronounceRows", () => {
    it("advertises the source row first, with the chords the actions are bound to", () => {
      const rows = pronounceRows(pair("en", "uk"), "Pronounce Word");
      expect(rows.map((row) => row.title)).toEqual(["Pronounce Word", "Pronounce Translation"]);
      expect(rows[0].shortcut).toBe(SHORTCUTS.pronounceWord);
      expect(rows[1].shortcut).toBe(SHORTCUTS.pronounceTranslation);
    });

    it("drops the row for a language PronounceAction refuses to render", () => {
      expect(pronounceRows(pair("xx", "uk"), "Pronounce Word").map((row) => row.title)).toEqual([
        "Pronounce Translation",
      ]);
      expect(pronounceRows(pair("en", "xx"), "Pronounce Word").map((row) => row.title)).toEqual(["Pronounce Word"]);
      expect(pronounceRows(pair("xx", "yy"), "Pronounce Word")).toEqual([]);
    });

    it("uses the caller's wording for the source row so it matches the action title", () => {
      const rows = pronounceRows(pair("en", "uk"), "Pronounce Original");
      expect(rows[0].title).toBe("Pronounce Original");
    });
  });
}
