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

import { existsSync, readdirSync, statSync, unlinkSync } from "fs";
import { pronounce, pronounceFallback } from "./tts";

const API_KEY = "test-key";

function ttsResponseBody(base64Audio: string): object {
  return {
    candidates: [
      {
        content: {
          parts: [{ inlineData: { data: base64Audio } }],
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

    const result = await pronounce("hello", API_KEY, "en");

    expect(result.cached).toBe(false);
    expect(fetch).toHaveBeenCalledOnce();
    const fetchCall = vi.mocked(fetch).mock.calls[0];
    // URL targets the Gemini TTS endpoint without snapshotting a specific model name —
    // the default may change over time as preview models are retired.
    expect(fetchCall[0]).toMatch(
      /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/[^:]+:generateContent$/,
    );

    const body = JSON.parse((fetchCall[1] as RequestInit).body as string);
    expect(body.contents[0].parts[0].text).toBe("hello");
    expect(body.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Kore");
  });

  it("uses the model passed via parameter (not a hardcoded default)", async () => {
    const fakePcm = Buffer.alloc(48).toString("base64");
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(ttsResponseBody(fakePcm)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const customModel = "custom-tts-model-xyz";
    await pronounce("hello", API_KEY, "en", undefined, customModel);

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    expect(fetchCall[0]).toContain(`/${customModel}:generateContent`);
  });

  it("throws TTS_MODEL_NOT_FOUND on 404 and carries the model name in cause", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{"error":{"code":404,"status":"NOT_FOUND"}}', { status: 404 }));
    const customModel = "gemini-2.5-flash-preview-tts";
    let caught: unknown;
    try {
      await pronounce("hello", API_KEY, "en", undefined, customModel);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("TTS_MODEL_NOT_FOUND");
    expect((caught as Error).cause).toEqual({ model: customModel });
  });

  it("skips API call when cache exists", async () => {
    vi.mocked(existsSync).mockImplementation((p) => {
      // Return true for the cache file, false for the directory check
      return String(p).endsWith(".wav");
    });

    const result = await pronounce("hello", API_KEY, "en");

    expect(result.cached).toBe(true);
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

  it("throws TTS_REQUEST_FAILED on non-ok response and carries status + body in cause", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("Server Error", { status: 500 }));
    let caught: unknown;
    try {
      await pronounce("hello", API_KEY, "en");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("TTS_REQUEST_FAILED");
    expect((caught as Error).cause).toEqual({ status: 500, body: "Server Error" });
  });

  it("throws TTS_INVALID_RESPONSE when body does not match the schema", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{"unexpected":"shape"}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    let caught: unknown;
    try {
      await pronounce("hello", API_KEY, "en");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("TTS_INVALID_RESPONSE");
    expect((caught as Error).cause).toHaveProperty("body");
  });

  it("throws TTS_EMPTY_RESPONSE when no audio data", async () => {
    const emptyResponse = {
      candidates: [{ content: { parts: [{ inlineData: { data: "" } }] } }],
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(emptyResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(pronounce("hello", API_KEY, "en")).rejects.toThrow("TTS_EMPTY_RESPONSE");
  });

  it("evicts oldest files when cache exceeds MAX_CACHE_FILES", async () => {
    const fakePcm = Buffer.alloc(48).toString("base64");
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(ttsResponseBody(fakePcm)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Simulate 51 cached .wav files (exceeds MAX_CACHE_FILES=50)
    const fileNames = Array.from({ length: 51 }, (_, i) => `en-${String(i).padStart(3, "0")}.wav`);
    vi.mocked(readdirSync).mockReturnValue(fileNames as unknown as ReturnType<typeof readdirSync>);
    vi.mocked(statSync).mockImplementation(
      (p) =>
        ({
          mtimeMs: parseInt(String(p).match(/(\d{3})\.wav/)?.[1] ?? "0"),
        }) as ReturnType<typeof statSync>,
    );

    await pronounce("hello", API_KEY, "en");

    // Oldest file (000) should be evicted
    expect(unlinkSync).toHaveBeenCalledWith(expect.stringContaining("en-000.wav"));
  });

  it("does not call fetch when signal is already aborted", async () => {
    const signal = AbortSignal.abort();
    await expect(pronounce("hello", API_KEY, "en", signal)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
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
