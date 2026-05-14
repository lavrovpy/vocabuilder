import { Action, Icon, Keyboard, Toast, getPreferenceValues, showToast } from "@raycast/api";
import { useEffect, useRef } from "react";
import { defaultToastFor } from "../lib/errorToast";
import { isGeminiError, isTransient } from "../lib/geminiError";
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
      toast.hide();

      const { title, message, fallback } = routeTtsError(err, languageCode);
      await showToast({ style: Toast.Style.Failure, title, message });

      if (fallback && hasMacOsFallback(languageCode)) {
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

type TtsErrorRouting = { title: string; message: string; fallback: boolean };

function routeTtsError(err: unknown, languageCode: string): TtsErrorRouting {
  if (isGeminiError(err)) {
    const base = defaultToastFor(err.cause);
    // TTS-specific overlay: when offline, foreshadow the say(1) fallback.
    if (err.cause.kind === "network-offline") {
      return { ...base, message: "Using system voice for now.", fallback: true };
    }
    return { ...base, fallback: isTransient(err) };
  }
  // Unknown error: keep the previous default — try the system voice if available.
  const error = err instanceof Error ? err : new Error(String(err));
  return {
    title: "Pronunciation failed",
    message: error.message || "Unknown error.",
    fallback: hasMacOsFallback(languageCode),
  };
}
