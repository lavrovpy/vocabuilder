/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Gemini API Key - Get a free key at aistudio.google.com */
  "geminiApiKey": string,
  /** Default Source Language - Used before you pick a language pair from the Translate dropdown */
  "sourceLanguage": "en" | "uk" | "pl" | "de" | "fr" | "es" | "it" | "pt" | "nl" | "cs" | "sv" | "ja" | "ko" | "zh" | "tr" | "ru" | "be",
  /** Default Target Language - Used before you pick a language pair from the Translate dropdown */
  "targetLanguage": "en" | "uk" | "pl" | "de" | "fr" | "es" | "it" | "pt" | "nl" | "cs" | "sv" | "ja" | "ko" | "zh" | "tr" | "ru" | "be",
  /** Read Clipboard on Open - If enabled, prefill a suggestion only when clipboard content is a safe single word */
  "readClipboardOnOpen"?: boolean,
  /** Translation Model - Gemini model used for translation. Use the custom model field only if you need an ID not listed here. */
  "translationModelPreset": "gemini-3.5-flash" | "gemini-3.1-flash-lite" | "gemini-3.1-pro-preview" | "gemini-3-flash-preview" | "gemini-2.5-flash" | "gemini-2.5-flash-lite" | "gemini-2.5-pro",
  /** Custom Translation Model ID - Optional advanced override. If set, it is used instead of Translation Model; reasoning controls are applied only for recognized models. */
  "translationModel"?: string,
  /** Reasoning Level - Controls Gemini reasoning for translations. None is fastest and lowest cost; higher levels may improve harder translations. */
  "reasoningLevel": "none" | "low" | "medium" | "high",
  /** Text-to-Speech Model - Gemini model used for word pronunciation. Use the custom model field only if you need an ID not listed here. */
  "ttsModelPreset": "gemini-3.1-flash-tts-preview" | "gemini-2.5-flash-preview-tts" | "gemini-2.5-pro-preview-tts",
  /** Custom Text-to-Speech Model ID - Optional advanced override. If set, it is used instead of Text-to-Speech Model. */
  "ttsModel"?: string
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

