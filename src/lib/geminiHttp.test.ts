import { describe, expect, it } from "vitest";

import { throwForHttpError } from "./geminiHttp";

const makeResponse = (status: number, body = ""): Response =>
  new Response(body, { status, statusText: `status-${status}` });

describe("throwForHttpError", () => {
  it("returns silently on 2xx", async () => {
    await expect(throwForHttpError(makeResponse(200), "translate", "m")).resolves.toBeUndefined();
  });

  it.each([401, 403])("maps %d to invalid-api-key with the caller's surface", async (status) => {
    try {
      await throwForHttpError(makeResponse(status), "tts", "m");
      throw new Error("did not throw");
    } catch (err) {
      expect((err as Error).cause).toMatchObject({
        domain: "infrastructure",
        kind: "invalid-api-key",
        surface: "tts",
      });
    }
  });

  it("maps 404 to model-not-found and includes the model id", async () => {
    try {
      await throwForHttpError(makeResponse(404), "translate", "gemini-bogus");
      throw new Error("did not throw");
    } catch (err) {
      expect((err as Error).cause).toMatchObject({
        domain: "infrastructure",
        kind: "model-not-found",
        surface: "translate",
        model: "gemini-bogus",
      });
    }
  });

  it.each([429, 500, 503])("maps other non-ok %d to request-failed with status + body", async (status) => {
    try {
      await throwForHttpError(makeResponse(status, "server said no"), "translate", "m");
      throw new Error("did not throw");
    } catch (err) {
      expect((err as Error).cause).toMatchObject({
        domain: "infrastructure",
        kind: "request-failed",
        surface: "translate",
        status,
        body: "server said no",
      });
    }
  });

  it("truncates oversized error bodies to 500 chars", async () => {
    const big = "x".repeat(2000);
    try {
      await throwForHttpError(makeResponse(500, big), "tts", "m");
      throw new Error("did not throw");
    } catch (err) {
      const cause = (err as Error).cause as { body: string };
      expect(cause.body).toHaveLength(500);
    }
  });
});
