import { Action, Icon, Keyboard, Toast, getPreferenceValues, showToast } from "@raycast/api";
import { isTtsSupported, pronounce, pronounceFallback } from "../lib/tts";

interface PronounceActionProps {
  word: string;
  languageCode: string;
  title?: string;
  shortcut: Keyboard.Shortcut;
}

export default function PronounceAction({ word, languageCode, title, shortcut }: PronounceActionProps) {
  if (!isTtsSupported(languageCode)) return null;

  async function handlePronounce() {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Generating pronunciation…" });
    try {
      const { geminiApiKey } = getPreferenceValues<Preferences.Translate>();
      await pronounce(word, geminiApiKey, languageCode);
      toast.hide();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[tts] Gemini TTS failed for "${word}" (${languageCode}), falling back to system voice. Reason: ${reason}`,
      );
      toast.title = "Using system voice…";
      try {
        await pronounceFallback(word, languageCode);
        toast.hide();
      } catch (fallbackErr) {
        const fallbackReason = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        console.error(
          `[tts] System voice fallback also failed for "${word}" (${languageCode}). Reason: ${fallbackReason}`,
        );
        toast.style = Toast.Style.Failure;
        toast.title = "Pronunciation failed";
        toast.message = "Could not play audio";
      }
    }
  }

  return (
    <Action title={title ?? "Pronounce Word"} icon={Icon.SpeakerHigh} shortcut={shortcut} onAction={handlePronounce} />
  );
}
