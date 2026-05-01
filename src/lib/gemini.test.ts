import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { translateWord, translateText } from "./gemini";
import type { LanguagePair } from "./languages";

const pair: LanguagePair = {
  source: { code: "en", name: "English" },
  target: { code: "uk", name: "Ukrainian" },
};

const API_KEY = "test-key";

function geminiJsonBody(payload: object): object {
  return {
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify(payload) }],
        },
      },
    ],
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("translateWord", () => {
  it("parses a valid Gemini response", async () => {
    const payload = {
      senses: [
        {
          translation: "привіт",
          partOfSpeech: "interjection",
          example: "Привіт!",
          exampleTranslation: "Hello!",
        },
      ],
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(geminiJsonBody(payload)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await translateWord("hello", API_KEY, pair);
    expect(result.senses).toHaveLength(1);
    expect(result.senses[0].translation).toBe("привіт");
    expect(result.senses[0].partOfSpeech).toBe("interjection");
  });

  it("dedupes senses with same translation+POS even if examples differ", async () => {
    const dup = {
      translation: "привіт",
      partOfSpeech: "interjection",
      example: "Привіт!",
      exampleTranslation: "Hello there!",
    };
    const payload = {
      senses: [dup, { ...dup, example: "Привіт, друже!", exampleTranslation: "Hello, friend!" }],
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(geminiJsonBody(payload)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await translateWord("hello", API_KEY, pair);
    expect(result.senses).toHaveLength(1);
  });

  it("removes byte-for-byte duplicate senses from the model", async () => {
    const s = {
      translation: "привіт",
      partOfSpeech: "interjection",
      example: "Привіт!",
      exampleTranslation: "Hello!",
    };
    const payload = { senses: [s, s] };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(geminiJsonBody(payload)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await translateWord("hello", API_KEY, pair);
    expect(result.senses).toHaveLength(1);
  });

  it("keeps same target gloss when part of speech differs", async () => {
    const base = {
      translation: "процент",
      example: "Привіт!",
      exampleTranslation: "Say hello to everyone.",
    };
    const payload = {
      senses: [
        { ...base, partOfSpeech: "noun" },
        { ...base, partOfSpeech: "verb", example: "Привіт, друже!", exampleTranslation: "Hello again!" },
      ],
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(geminiJsonBody(payload)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await translateWord("hello", API_KEY, pair);
    expect(result.senses).toHaveLength(2);
    expect(result.senses.map((x) => x.partOfSpeech).sort()).toEqual(["noun", "verb"]);
  });

  it("throws WORD_NOT_FOUND when notAWord is true", async () => {
    const payload = { senses: [], notAWord: true };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(geminiJsonBody(payload)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(translateWord("xqzptl", API_KEY, pair)).rejects.toThrow("WORD_NOT_FOUND");
  });

  it("throws GEMINI_INVALID_RESPONSE when senses array is empty without notAWord", async () => {
    const payload = { senses: [] };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(geminiJsonBody(payload)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(translateWord("zzzqqq", API_KEY, pair)).rejects.toThrow("GEMINI_INVALID_RESPONSE");
  });

  it("filters out senses whose exampleTranslation does not contain the word", async () => {
    const payload = {
      senses: [
        {
          translation: "привіт",
          partOfSpeech: "interjection",
          example: "Привіт!",
          exampleTranslation: "Hello!",
        },
        {
          translation: "збірка",
          partOfSpeech: "noun",
          example: "Ця збірка оповідань.",
          exampleTranslation: "This collection of stories.",
        },
      ],
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(geminiJsonBody(payload)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await translateWord("hello", API_KEY, pair);
    expect(result.senses).toHaveLength(1);
    expect(result.senses[0].translation).toBe("привіт");
  });

  it("throws GEMINI_INVALID_RESPONSE when all senses fail the word check", async () => {
    const payload = {
      senses: [
        {
          translation: "збірка",
          partOfSpeech: "noun",
          example: "Ця збірка оповідань.",
          exampleTranslation: "This collection of stories.",
        },
      ],
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(geminiJsonBody(payload)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(translateWord("omnibus", API_KEY, pair)).rejects.toThrow("GEMINI_INVALID_RESPONSE");
  });

  it("corrects a misspelled phrase and validates example against the corrected form", async () => {
    const payload = {
      senses: [
        {
          translation: "оманлива підказка",
          partOfSpeech: "idiom",
          example: "Ця підказка виявилася оманливою.",
          exampleTranslation: "That clue turned out to be a red herring.",
        },
      ],
      correctedWord: "red herring",
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(geminiJsonBody(payload)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await translateWord("red hering", API_KEY, pair);
    expect(result.senses).toHaveLength(1);
    expect(result.correctedWord).toBe("red herring");
    expect(result.senses[0].partOfSpeech).toBe("idiom");
  });

  it("validates exampleTranslation against correctedWord, not the original typo", async () => {
    const payload = {
      senses: [
        {
          translation: "бігти",
          partOfSpeech: "verb",
          example: "Він біжить швидко!",
          exampleTranslation: "She is running fast.",
        },
      ],
      correctedWord: "running",
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(geminiJsonBody(payload)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await translateWord("runing", API_KEY, pair);
    expect(result.senses).toHaveLength(1);
    expect(result.correctedWord).toBe("running");
  });

  it("matches Cyrillic words in exampleTranslation with Unicode-aware boundaries", async () => {
    const reversePair: LanguagePair = {
      source: { code: "uk", name: "Ukrainian" },
      target: { code: "en", name: "English" },
    };
    const payload = {
      senses: [
        {
          translation: "hello",
          partOfSpeech: "interjection",
          example: "Hello there!",
          exampleTranslation: "Привіт!",
        },
      ],
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(geminiJsonBody(payload)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await translateWord("привіт", API_KEY, reversePair);
    expect(result.senses).toHaveLength(1);
    expect(result.senses[0].translation).toBe("hello");
  });

  it("throws INVALID_API_KEY on 401", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    await expect(translateWord("hello", API_KEY, pair)).rejects.toThrow("INVALID_API_KEY");
  });

  it("throws INVALID_API_KEY on 403", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("Forbidden", { status: 403 }));
    await expect(translateWord("hello", API_KEY, pair)).rejects.toThrow("INVALID_API_KEY");
  });

  it("throws GEMINI_REQUEST_FAILED with cause carrying status and body on non-401/403 failures", async () => {
    const body = '{"error":{"code":429,"message":"Resource has been exhausted"}}';
    vi.mocked(fetch).mockResolvedValue(new Response(body, { status: 429 }));
    try {
      await translateWord("hello", API_KEY, pair);
      throw new Error("expected rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("GEMINI_REQUEST_FAILED");
      const cause = (err as Error).cause as { status?: number; body?: string } | undefined;
      expect(cause?.status).toBe(429);
      expect(cause?.body).toContain("Resource has been exhausted");
    }
  });

  it("truncates long error bodies on the cause to 500 chars", async () => {
    const huge = "x".repeat(2000);
    vi.mocked(fetch).mockResolvedValue(new Response(huge, { status: 500 }));
    try {
      await translateWord("hello", API_KEY, pair);
      throw new Error("expected rejection");
    } catch (err) {
      const cause = (err as Error).cause as { status?: number; body?: string };
      expect(cause.status).toBe(500);
      expect(cause.body!.length).toBe(500);
    }
  });

  it("throws GEMINI_EMPTY_RESPONSE when response text is empty", async () => {
    const body = {
      candidates: [{ content: { parts: [{ text: "" }] } }],
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(translateWord("hello", API_KEY, pair)).rejects.toThrow("GEMINI_EMPTY_RESPONSE");
  });

  it("throws GEMINI_INVALID_RESPONSE when JSON is malformed", async () => {
    const body = {
      candidates: [{ content: { parts: [{ text: "not json at all" }] } }],
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(translateWord("hello", API_KEY, pair)).rejects.toThrow("GEMINI_INVALID_RESPONSE");
  });

  it("throws INVALID_WORD_INPUT for empty input", async () => {
    await expect(translateWord("", API_KEY, pair)).rejects.toThrow("INVALID_WORD_INPUT");
  });

  it("throws NETWORK_OFFLINE when fetch fails with a network TypeError", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));
    await expect(translateWord("hello", API_KEY, pair)).rejects.toThrow("NETWORK_OFFLINE");
  });
});

describe("translateText", () => {
  it("parses a valid text translation response", async () => {
    const payload = { translation: "Привіт світ" };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(geminiJsonBody(payload)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await translateText("Hello world", API_KEY, pair);
    expect(result.translation).toBe("Привіт світ");
  });

  it("throws INVALID_TEXT_INPUT for empty input", async () => {
    await expect(translateText("", API_KEY, pair)).rejects.toThrow("INVALID_TEXT_INPUT");
  });

  it("throws NETWORK_OFFLINE when fetch fails with a network TypeError", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));
    await expect(translateText("Hello world", API_KEY, pair)).rejects.toThrow("NETWORK_OFFLINE");
  });
});
