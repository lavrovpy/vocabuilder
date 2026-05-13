import { Action, Icon, Keyboard, Toast, getPreferenceValues, showToast } from "@raycast/api";
import { useEffect, useRef } from "react";
import { hasMacOsFallback, isTtsSupported, pronounce, pronounceFallback } from "../lib/tts";

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
      const reason = err instanceof Error ? err.message : String(err);
      const causeModel = err instanceof Error ? (err.cause as { model?: string } | undefined)?.model : undefined;

      if (reason === "TTS_MODEL_NOT_FOUND") {
        const modelLabel = causeModel ?? "the configured model";
        await showToast({
          style: Toast.Style.Failure,
          title: "Text-to-speech model not found",
          message: `Model "${modelLabel}" is unavailable or deprecated. Update "Text-to-Speech Model" in extension preferences.`,
        });
        toast.hide();
        if (hasMacOsFallback(languageCode)) {
          try {
            await pronounceFallback(word, languageCode);
          } catch {
            // ignore — the main toast already surfaced the config problem
          }
        }
        return;
      }

      if (!hasMacOsFallback(languageCode)) {
        toast.style = Toast.Style.Failure;
        toast.title = "Pronunciation failed";
        toast.message = reason === "NETWORK_OFFLINE" ? "No internet connection" : "Could not generate audio";
        return;
      }
      toast.title = "Using system voice…";
      try {
        await pronounceFallback(word, languageCode);
        toast.hide();
      } catch {
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
