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

