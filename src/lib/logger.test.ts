import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger, sanitizeLogFields } from "./logger";

describe("sanitizeLogFields", () => {
  it("redacts fields that may contain secrets or user text", () => {
    expect(
      sanitizeLogFields({
        apiKey: "secret",
        prompt: "translate this",
        word: "private",
        model: "gemini-3-flash-preview",
        attemptMs: 123,
      }),
    ).toEqual({
      apiKey: "[redacted]",
      prompt: "[redacted]",
      word: "[redacted]",
      model: "gemini-3-flash-preview",
      attemptMs: 123,
    });
  });

  it("keeps useful non-sensitive nested diagnostics", () => {
    expect(
      sanitizeLogFields({
        rateLimit: {
          quotaMetric: "generativelanguage.googleapis.com/generate_content_requests",
          quotaId: "GenerateRequestsPerMinutePerProjectPerModel",
          quotaDimensions: { model: "gemini-3-flash-preview", location: "global" },
        },
      }),
    ).toEqual({
      rateLimit: {
        quotaMetric: "generativelanguage.googleapis.com/generate_content_requests",
        quotaId: "GenerateRequestsPerMinutePerProjectPerModel",
        quotaDimensions: { model: "gemini-3-flash-preview", location: "global" },
      },
    });
  });

  it("does not preserve arbitrary Error messages that may contain user data", () => {
    expect(sanitizeLogFields({ error: new Error("Command failed with private text") })).toEqual({
      error: { name: "Error" },
    });
  });
});

describe("createLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes scoped structured logs when explicitly enabled", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const logger = createLogger("test-scope", { enabled: true });

    logger.debug("event", { model: "m", apiKey: "secret" });

    expect(debug).toHaveBeenCalledWith("[test-scope] event", { model: "m", apiKey: "[redacted]" });
  });

  it("stays silent in test mode by default", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const logger = createLogger("test-scope");

    logger.debug("event", { model: "m" });

    expect(debug).not.toHaveBeenCalled();
  });
});
