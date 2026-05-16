/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Gemini API Key - Get a free key at aistudio.google.com */
  "geminiApiKey": string,
  /** Source Language - The language you want to translate from */
  "sourceLanguage": "en" | "uk" | "pl" | "de" | "fr" | "es" | "it" | "pt" | "nl" | "cs" | "sv" | "ja" | "ko" | "zh" | "tr" | "ru" | "be",
  /** Target Language - The language you want to translate to */
  "targetLanguage": "en" | "uk" | "pl" | "de" | "fr" | "es" | "it" | "pt" | "nl" | "cs" | "sv" | "ja" | "ko" | "zh" | "tr" | "ru" | "be",
  /** Read Clipboard on Open - If enabled, prefill a suggestion only when clipboard content is a safe single word */
  "readClipboardOnOpen"?: boolean,
  /** Translation Model - Gemini model ID for translation (e.g. gemini-2.5-flash, gemini-3-flash-preview). Leave blank to use the default. Override if your model is deprecated. */
  "translationModel": string,
  /** Text-to-Speech Model - Gemini TTS model ID for word pronunciation. Leave blank to use the default. Override if your model is deprecated. */
  "ttsModel": string
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

