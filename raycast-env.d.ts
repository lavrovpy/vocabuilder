/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Provider - AI service used for translation, and for pronunciation unless a Pronunciation API Key is set. Auto-detect picks Gemini, Anthropic or OpenAI from the API key prefix; choose a provider explicitly for any other key. */
  "provider": "auto" | "gemini" | "anthropic" | "openai" | "openai-compatible",
  /** API Key - Key for your provider. Auto-detect recognizes Gemini (AIza…), Anthropic (sk-ant-…) and OpenAI (sk-…) keys. Local servers that need no key accept any value. */
  "apiKey": string,
  /** API Server URL - Advanced. Leave empty to use the provider's official endpoint; required for an OpenAI-Compatible Server. Accepts a server root or a full API base, for example http://localhost:11434/v1 or https://openrouter.ai/api/v1. Your API key is sent to this host. Do not include credentials or a query string. Plain http is accepted only for local addresses (localhost, 127.0.0.1, [::1], 0.0.0.0). */
  "apiBaseUrl"?: string,
  /** Default Source Language - Used before you pick a language pair from the Translate dropdown */
  "sourceLanguage": "en" | "uk" | "pl" | "de" | "fr" | "es" | "it" | "pt" | "nl" | "cs" | "sv" | "ja" | "ko" | "zh" | "tr" | "ru" | "be",
  /** Default Target Language - Used before you pick a language pair from the Translate dropdown */
  "targetLanguage": "en" | "uk" | "pl" | "de" | "fr" | "es" | "it" | "pt" | "nl" | "cs" | "sv" | "ja" | "ko" | "zh" | "tr" | "ru" | "be",
  /** Translation Model - Model ID used for translation. Leave empty for the provider default: gemini-3.5-flash-lite (Gemini), claude-haiku-5-5 (Anthropic), gpt-6-luna (OpenAI). Required for an OpenAI-Compatible Server. */
  "translationModel"?: string,
  /** Text-to-Speech Model - Model ID used for word pronunciation. Leave empty for the speech provider's default: gemini-3.1-flash-tts-preview (Gemini), gpt-4o-mini-tts (OpenAI). OpenAI tts-1 and tts-1-hd use the macOS system voice to preserve the selected language. */
  "ttsModel"?: string,
  /** Pronunciation - Provider voice uses Gemini or OpenAI speech and falls back to the macOS system voice when it is unavailable. Anthropic and OpenAI-Compatible Servers have no speech, so they use the macOS system voice unless you set a Pronunciation API Key. */
  "pronunciation": "auto" | "system",
  /** Pronunciation API Key - Optional. A Gemini (AIza…) or OpenAI (sk-…) key used only for pronunciation, so words get that provider's voice whichever provider translates, for example with an Anthropic key. Always sent to that provider's official endpoint, never to API Server URL. Leave empty to use your translation provider's voice. */
  "pronunciationApiKey"?: string,
  /** Read Clipboard on Open - If enabled, prefill a suggestion only when clipboard content is a safe word or short phrase */
  "readClipboardOnOpen"?: boolean
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `translate` command */
  export type Translate = ExtensionPreferences & {}
  /** Preferences accessible in the `history` command */
  export type History = ExtensionPreferences & {}
  /** Preferences accessible in the `flashcards` command */
  export type Flashcards = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `translate` command */
  export type Translate = {}
  /** Arguments passed to the `history` command */
  export type History = {}
  /** Arguments passed to the `flashcards` command */
  export type Flashcards = {}
}

