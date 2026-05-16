import { Action, Icon, Keyboard, Toast, getPreferenceValues, showToast } from "@raycast/api";
import { useEffect, useRef } from "react";
import { defaultToastFor } from "../lib/errorToast";
import { isGeminiError, isTransient } from "../lib/geminiError";
import { hasMacOsFallback, isTtsSupported, pronounce, pronounceFallback } from "../lib/tts";
import { getPreferenceDefault } from "../lib/manifest";
import { runPronounceWithFallback } from "../lib/pronounceFlow";

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
    const { geminiApiKey, ttsModel } = getPreferenceValues<Preferences.Translate>();
    const model = ttsModel.trim() || getPreferenceDefault("ttsModel");

    const outcome = await runPronounceWithFallback({
      signal: controller.signal,
      attemptPrimary: () => pronounce(word, geminiApiKey, languageCode, controller.signal, model),
      attemptFallback: hasMacOsFallback(languageCode) ? () => pronounceFallback(word, languageCode) : null,
      routeError: (err) => routeTtsError(err, languageCode),
    });

    switch (outcome.kind) {
      case "primary":
        if (!outcome.cached) toast.title = "Generated pronunciation";
        await toast.hide();
        return;
      case "aborted":
        await toast.hide();
        return;
      case "fallback-ok":
        await toast.hide();
        await showToast({ style: Toast.Style.Success, title: "Using system voice", message: outcome.message });
        return;
      case "failed":
        await toast.hide();
        await showToast({ style: Toast.Style.Failure, title: outcome.title, message: outcome.message });
        return;
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
    if (err.cause.kind === "network-offline") {
      // Special-cased only to override the toast message; the fallback decision still
      // comes from isTransient (which already includes network-offline).
      return { ...base, message: "Using system voice for now.", fallback: isTransient(err) };
    }
    // Intentionally broader than the pre-refactor 5xx-only check: isTransient also
    // covers 429 (rate-limited) and 408 (timeout). Both are better served by say(1)
    // than by a failure toast — narrowing this back would be a UX regression.
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
