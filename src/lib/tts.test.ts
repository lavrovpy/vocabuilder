import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("child_process", () => ({
  execFile: vi.fn((_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
    cb(null);
  }),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ mtimeMs: 0 })),
    unlinkSync: vi.fn(),
  };
});

import { existsSync } from "fs";
import { pronounce, pronounceFallback } from "./tts";

const API_KEY = "test-key";

function ttsResponseBody(base64Audio: string): object {
  return {
    candidates: [
      {
        content: {
          parts: [
            {
              inlineData: {
                mimeType: "audio/L16;rate=24000",
                data: base64Audio,
              },
            },
          ],
        },
      },
    ],
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.mocked(existsSync).mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pronounce", () => {
  it("calls Gemini TTS API and plays audio", async () => {
    const fakePcm = Buffer.alloc(48).toString("base64");
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(ttsResponseBody(fakePcm)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await pronounce("hello", API_KEY, "en");

    expect(fetch).toHaveBeenCalledOnce();
    const fetchCall = vi.mocked(fetch).mock.calls[0];
    expect(fetchCall[0]).toContain("gemini-2.5-flash-preview-tts");

    const body = JSON.parse((fetchCall[1] as RequestInit).body as string);
    expect(body.contents[0].parts[0].text).toBe("hello");
    expect(body.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Kore");
  });

  it("skips API call when cache exists", async () => {
    vi.mocked(existsSync).mockImplementation((p) => {
      // Return true for the cache file, false for the directory check
      return String(p).endsWith(".wav");
    });

    await pronounce("hello", API_KEY, "en");

    expect(fetch).not.toHaveBeenCalled();
  });

  it("throws INVALID_API_KEY on 401", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    await expect(pronounce("hello", API_KEY, "en")).rejects.toThrow("INVALID_API_KEY");
  });

  it("throws INVALID_API_KEY on 403", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("Forbidden", { status: 403 }));
    await expect(pronounce("hello", API_KEY, "en")).rejects.toThrow("INVALID_API_KEY");
  });

  it("throws NETWORK_OFFLINE on network TypeError", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));
    await expect(pronounce("hello", API_KEY, "en")).rejects.toThrow("NETWORK_OFFLINE");
  });

  it("throws TTS_REQUEST_FAILED on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("Server Error", { status: 500 }));
    await expect(pronounce("hello", API_KEY, "en")).rejects.toThrow("TTS_REQUEST_FAILED");
  });

  it("throws TTS_EMPTY_RESPONSE when no audio data", async () => {
    const emptyResponse = {
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16", data: "" } }] } }],
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(emptyResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(pronounce("hello", API_KEY, "en")).rejects.toThrow("TTS_EMPTY_RESPONSE");
  });
});

describe("pronounceFallback", () => {
  it("calls macOS say with correct voice for English", async () => {
    const { execFile } = await import("child_process");
    await pronounceFallback("hello", "en");
    expect(execFile).toHaveBeenCalledWith("/usr/bin/say", ["-v", "Samantha", "hello"], expect.any(Function));
  });

  it("calls macOS say with correct voice for Ukrainian", async () => {
    const { execFile } = await import("child_process");
    await pronounceFallback("привіт", "uk");
    expect(execFile).toHaveBeenCalledWith("/usr/bin/say", ["-v", "Lesya", "привіт"], expect.any(Function));
  });
});
