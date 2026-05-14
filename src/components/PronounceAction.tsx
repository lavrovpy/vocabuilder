import { Action, Icon, Keyboard, Toast, getPreferenceValues, showToast } from "@raycast/api";
import { useEffect, useRef } from "react";
import { hasMacOsFallback, isTtsSupported, pronounce, pronounceFallback } from "../lib/tts";
import { routeTtsError } from "../lib/tts-errors";

interface PronounceActionProps {
  word: string;
  languageCode: string;
  title?: string;
  shortcut: Keyboard.Shortcut;
}

export default function PronounceAction({ word, languageCode, title, shortcut }: PronounceActionProps) {
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  if (!isTtsSupported(languageCode)) return null;

  async function handlePronounce() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const toast = await showToast({ style: Toast.Style.Animated, title: "Playing pronunciation…" });
    try {
      const { geminiApiKey, ttsModel } = getPreferenceValues<Preferences.Translate>();
      const { cached } = await pronounce(word, geminiApiKey, languageCode, controller.signal, ttsModel);
      if (!cached) toast.title = "Generated pronunciation";
      toast.hide();
    } catch (err) {
      if (controller.signal.aborted) return;
      toast.hide();

      const canUseFallback = hasMacOsFallback(languageCode);
      const { title, message, fallback } = routeTtsError(err, canUseFallback);
      await showToast({ style: Toast.Style.Failure, title, message });

      if (fallback && canUseFallback) {
        try {
          await pronounceFallback(word, languageCode);
        } catch {
          // user already saw the Failure toast — swallowing the say(1) error is fine
        }
      }
    }
  }

  return (
    <Action title={title ?? "Pronounce Word"} icon={Icon.SpeakerHigh} shortcut={shortcut} onAction={handlePronounce} />
  );
}
