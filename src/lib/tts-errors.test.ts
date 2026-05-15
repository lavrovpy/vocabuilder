import { describe, it, expect } from "vitest";
import { routeTtsError } from "./tts-errors";

describe("routeTtsError", () => {
  it("only promises system voice on offline errors when macOS fallback is available", () => {
    expect(routeTtsError(new Error("NETWORK_OFFLINE"), true)).toEqual({
      title: "No internet connection",
      message: "Using system voice for now.",
      fallback: true,
    });

    expect(routeTtsError(new Error("NETWORK_OFFLINE"), false)).toEqual({
      title: "No internet connection",
      message: "Pronunciation needs internet for this language.",
      fallback: false,
    });
  });

  it("mentions system voice for Gemini 5xx TTS failures when fallback is available", () => {
    expect(routeTtsError(new Error("TTS_REQUEST_FAILED", { cause: { status: 500 } }), true)).toEqual({
      title: "Pronunciation request failed",
      message: "Gemini service error. Using system voice for now.",
      fallback: true,
    });
  });

  it("does not promise system voice for Gemini 5xx TTS failures without fallback", () => {
    expect(routeTtsError(new Error("TTS_REQUEST_FAILED", { cause: { status: 500 } }), false)).toEqual({
      title: "Pronunciation request failed",
      message: "Gemini service error. Please try again.",
      fallback: true,
    });
  });

  it("keeps preference guidance for non-server TTS failures", () => {
    expect(routeTtsError(new Error("TTS_REQUEST_FAILED", { cause: { status: 400 } }), true)).toEqual({
      title: "Pronunciation request failed",
      message: "Gemini returned 400. Check your TTS model in preferences.",
      fallback: false,
    });
  });

  it("leaves unknown errors eligible for caller-gated fallback", () => {
    expect(routeTtsError(new Error("SAY_WHAT"), false)).toEqual({
      title: "Pronunciation failed",
      message: "SAY_WHAT",
      fallback: true,
    });
  });
});
