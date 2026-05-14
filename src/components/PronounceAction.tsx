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
  const error = err instanceof Error ? err : new Error(String(err));
  const cause = (error.cause ?? {}) as { model?: string; status?: number; body?: string };

  switch (error.message) {
    case "NETWORK_OFFLINE":
      return { title: "No internet connection", message: "Using system voice for now.", fallback: true };
    case "INVALID_API_KEY":
      return {
        title: "Invalid Gemini API key",
        message: "Update your key in extension preferences.",
        fallback: false,
      };
    case "TTS_MODEL_NOT_FOUND": {
      const model = cause.model ?? "configured model";
      return {
        title: "TTS model not found",
        message: `Model "${model}" is unavailable. Update "Text-to-Speech Model" in preferences.`,
        fallback: false,
      };
    }
    case "TTS_REQUEST_FAILED": {
      const status = cause.status;
      const is5xx = typeof status === "number" && status >= 500 && status < 600;
      return {
        title: "Pronunciation request failed",
        message: status
          ? `Gemini returned ${status}. Check your TTS model in preferences.`
          : "Check your TTS model in preferences.",
        fallback: is5xx,
      };
    }
    case "TTS_INVALID_RESPONSE":
      return {
        title: "Unexpected response from Gemini",
        message: "The TTS model returned an unrecognized format. Try another model in preferences.",
        fallback: false,
      };
    case "TTS_EMPTY_RESPONSE":
      return {
        title: "No audio returned",
        message: "Try again or pick a different model.",
        fallback: false,
      };
    default:
      return {
        title: "Pronunciation failed",
        message: error.message || "Unknown error.",
        fallback: hasMacOsFallback(languageCode),
      };
  }
}
