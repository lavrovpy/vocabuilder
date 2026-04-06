import { environment } from "@raycast/api";
import { execFile } from "child_process";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { GeminiTtsResponseSchema } from "./types";

const TTS_MODEL = "gemini-2.5-flash-preview-tts";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_VOICE = "Kore";
const SAMPLE_RATE = 24000;
const NUM_CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const MAX_CACHE_FILES = 50;

const LANGUAGE_VOICE_MAP: Record<string, string> = {
  en: "Kore",
  uk: "Kore",
  de: "Kore",
  fr: "Kore",
  es: "Kore",
  it: "Kore",
  pt: "Kore",
  nl: "Kore",
  pl: "Kore",
  cs: "Kore",
  sv: "Kore",
  ja: "Kore",
  ko: "Kore",
  zh: "Kore",
  tr: "Kore",
  ru: "Kore",
  be: "Kore",
};

const MACOS_VOICE_MAP: Record<string, string> = {
  en: "Samantha",
  uk: "Lesya",
  de: "Anna",
  fr: "Thomas",
  es: "Monica",
  it: "Alice",
  pt: "Luciana",
  nl: "Xander",
  pl: "Zosia",
  cs: "Zuzana",
  sv: "Alva",
  ja: "Kyoko",
  ko: "Yuna",
  zh: "Ting-Ting",
  tr: "Yelda",
  ru: "Milena",
};

function voiceForLanguage(langCode: string): string {
  return LANGUAGE_VOICE_MAP[langCode] ?? DEFAULT_VOICE;
}

export function isTtsSupported(langCode: string): boolean {
  return langCode in LANGUAGE_VOICE_MAP;
}

export function hasMacOsFallback(langCode: string): boolean {
  return langCode in MACOS_VOICE_MAP;
}

function macosVoiceForLanguage(langCode: string): string {
  return MACOS_VOICE_MAP[langCode] ?? "Samantha";
}

function prependWavHeader(pcm: Buffer, sampleRate: number, numChannels: number, bitsPerSample: number): Buffer {
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcm.length;
  const headerSize = 44;

  const header = Buffer.alloc(headerSize);
  header.write("RIFF", 0);
  header.writeUInt32LE(dataSize + headerSize - 8, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

function getCacheDir(): string {
  const dir = path.join(environment.supportPath, "tts-cache");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function cacheKey(word: string, langCode: string): string {
  const hash = createHash("sha256").update(word.toLowerCase()).digest("hex").slice(0, 32);
  return `${langCode}-${hash}.wav`;
}

function evictOldestCacheFiles(dir: string, maxFiles: number): void {
  const files = readdirSync(dir)
    .map((name) => {
      const filePath = path.join(dir, name);
      const stat = statSync(filePath);
      return { filePath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  while (files.length > maxFiles) {
    const oldest = files.shift()!;
    try {
      unlinkSync(oldest.filePath);
    } catch {
      // ignore cleanup failures
    }
  }
}

function playAudio(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/afplay", [filePath], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function generateSpeechGemini(
  text: string,
  apiKey: string,
  langCode: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  const url = `${BASE_URL}/${TTS_MODEL}:generateContent`;
  const voice = voiceForLanguage(langCode);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice },
            },
          },
        },
      }),
      signal,
    });
  } catch (err) {
    if (err instanceof TypeError) {
      console.error("[tts] Gemini TTS network error:", err.message);
      throw new Error("NETWORK_OFFLINE");
    }
    console.error("[tts] Gemini TTS unexpected fetch error:", err);
    throw err;
  }

  if (response.status === 401 || response.status === 403) {
    console.error(`[tts] Gemini TTS auth error: HTTP ${response.status}`);
    throw new Error("INVALID_API_KEY");
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    console.error(`[tts] Gemini TTS request failed: HTTP ${response.status}`, body);
    throw new Error("TTS_REQUEST_FAILED");
  }

  let apiData;
  try {
    apiData = GeminiTtsResponseSchema.parse(await response.json());
  } catch (err) {
    console.error("[tts] Gemini TTS response did not match expected schema:", err);
    throw new Error("TTS_REQUEST_FAILED");
  }
  const base64Audio = apiData.candidates[0]?.content.parts[0]?.inlineData.data;

  if (!base64Audio) {
    console.error("[tts] Gemini TTS returned empty audio data");
    throw new Error("TTS_EMPTY_RESPONSE");
  }

  const pcm = Buffer.from(base64Audio, "base64");
  return prependWavHeader(pcm, SAMPLE_RATE, NUM_CHANNELS, BITS_PER_SAMPLE);
}

export async function pronounce(word: string, apiKey: string, langCode: string, signal?: AbortSignal): Promise<void> {
  const dir = getCacheDir();
  const fileName = cacheKey(word, langCode);
  const filePath = path.join(dir, fileName);

  if (existsSync(filePath)) {
    console.log(`[tts] Cache hit for "${word}" (${langCode}), playing from cache`);
  } else {
    console.log(`[tts] Cache miss for "${word}" (${langCode}), calling Gemini TTS...`);
    const wavBuffer = await generateSpeechGemini(word, apiKey, langCode, signal);
    writeFileSync(filePath, wavBuffer);
    console.log(`[tts] Gemini TTS success for "${word}", cached to ${fileName}`);
    evictOldestCacheFiles(dir, MAX_CACHE_FILES);
  }

  await playAudio(filePath);
}

export async function pronounceFallback(word: string, langCode: string): Promise<void> {
  const voice = macosVoiceForLanguage(langCode);
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/say", ["-v", voice, word], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// --- In-source tests for private functions ---
if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("voiceForLanguage", () => {
    it("returns Kore for known languages", () => {
      expect(voiceForLanguage("en")).toBe("Kore");
      expect(voiceForLanguage("uk")).toBe("Kore");
    });

    it("returns default for unknown language", () => {
      expect(voiceForLanguage("xx")).toBe(DEFAULT_VOICE);
    });
  });

  describe("macosVoiceForLanguage", () => {
    it("returns Samantha for English", () => {
      expect(macosVoiceForLanguage("en")).toBe("Samantha");
    });

    it("returns Lesya for Ukrainian", () => {
      expect(macosVoiceForLanguage("uk")).toBe("Lesya");
    });

    it("returns Samantha for unknown language", () => {
      expect(macosVoiceForLanguage("xx")).toBe("Samantha");
    });
  });

  describe("isTtsSupported", () => {
    it("returns true for languages with Gemini TTS voices", () => {
      expect(isTtsSupported("en")).toBe(true);
      expect(isTtsSupported("uk")).toBe(true);
      expect(isTtsSupported("be")).toBe(true);
    });

    it("returns false for unknown languages", () => {
      expect(isTtsSupported("xx")).toBe(false);
    });
  });

  describe("hasMacOsFallback", () => {
    it("returns true for languages with macOS voices", () => {
      expect(hasMacOsFallback("en")).toBe(true);
      expect(hasMacOsFallback("uk")).toBe(true);
    });

    it("returns false for Belarusian (no macOS voice)", () => {
      expect(hasMacOsFallback("be")).toBe(false);
    });
  });

  describe("cacheKey", () => {
    it("produces deterministic filesystem-safe names with fixed length", () => {
      const key = cacheKey("hello", "en");
      // lang(2) + dash(1) + sha256-prefix(32) + .wav(4) = 39 chars
      expect(key).toMatch(/^en-[0-9a-f]{32}\.wav$/);
      expect(key.length).toBe(39);
    });

    it("is case-insensitive", () => {
      expect(cacheKey("Hello", "en")).toBe(cacheKey("hello", "en"));
    });

    it("handles unicode words", () => {
      const key = cacheKey("привіт", "uk");
      expect(key).toMatch(/^uk-[0-9a-f]{32}\.wav$/);
    });

    it("keeps filenames short even for long text", () => {
      const longText = "a".repeat(1000);
      const key = cacheKey(longText, "en");
      expect(key.length).toBe(39);
    });
  });

  describe("prependWavHeader", () => {
    it("produces a buffer starting with RIFF header", () => {
      const pcm = Buffer.alloc(100);
      const wav = prependWavHeader(pcm, 24000, 1, 16);
      expect(wav.length).toBe(144); // 44 header + 100 data
      expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
      expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
      expect(wav.toString("ascii", 12, 16)).toBe("fmt ");
      expect(wav.toString("ascii", 36, 40)).toBe("data");
    });

    it("encodes correct sample rate", () => {
      const pcm = Buffer.alloc(48);
      const wav = prependWavHeader(pcm, 24000, 1, 16);
      expect(wav.readUInt32LE(24)).toBe(24000);
    });

    it("encodes correct data size", () => {
      const pcm = Buffer.alloc(200);
      const wav = prependWavHeader(pcm, 24000, 1, 16);
      expect(wav.readUInt32LE(40)).toBe(200);
    });

    it("encodes correct total file size in RIFF header", () => {
      const pcm = Buffer.alloc(200);
      const wav = prependWavHeader(pcm, 24000, 1, 16);
      expect(wav.readUInt32LE(4)).toBe(200 + 44 - 8); // dataSize + headerSize - 8
    });
  });
}
