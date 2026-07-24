/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Gemini API Key - Get a free key at aistudio.google.com */
  "geminiApiKey": string,
  /** API Base URL - Advanced. Send translation and pronunciation requests to an endpoint that speaks the native Gemini REST protocol, for example a proxy or gateway. Include the API version and the models segment, as in https://your-gateway/v1beta/models. Plain http is accepted only for localhost. */
  "geminiApiBaseUrl": string,
  /** Default Source Language - Used before you pick a language pair from the Translate dropdown */
  "sourceLanguage": "en" | "uk" | "pl" | "de" | "fr" | "es" | "it" | "pt" | "nl" | "cs" | "sv" | "ja" | "ko" | "zh" | "tr" | "ru" | "be",
  /** Default Target Language - Used before you pick a language pair from the Translate dropdown */
  "targetLanguage": "en" | "uk" | "pl" | "de" | "fr" | "es" | "it" | "pt" | "nl" | "cs" | "sv" | "ja" | "ko" | "zh" | "tr" | "ru" | "be",
  /** Translation Model - Gemini model ID used for translation. Paste the unprefixed model name, for example gemini-3.5-flash. */
  "translationModel": string,
  /** Text-to-Speech Model - Gemini TTS model ID used for word pronunciation. Paste the unprefixed model name, for example gemini-3.1-flash-tts-preview. */
  "ttsModel": string,
  /** Read Clipboard on Open - If enabled, prefill a suggestion only when clipboard content is a safe single word */
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

