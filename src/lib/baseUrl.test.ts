import { describe, it, expect } from "vitest";
import { customEndpointHost, hostForLog, resolveBaseUrl } from "./baseUrl";
import { isGeminiError } from "./geminiError";
import { getPreferenceDefault } from "./manifest";

function expectRejected(raw: string | undefined) {
  try {
    resolveBaseUrl(raw, "translate");
  } catch (err) {
    expect(isGeminiError(err)).toBe(true);
    if (!isGeminiError(err)) return;
    expect(err.cause.kind).toBe("invalid-base-url");
    expect(err.cause.domain).toBe("infrastructure");
    return;
  }
  throw new Error(`expected ${JSON.stringify(raw)} to be rejected`);
}

describe("resolveBaseUrl", () => {
  it.each([
    ["https://gw.corp/gemini", "https://gw.corp/gemini/v1beta/models"],
    ["https://gw.corp/gemini/v1beta", "https://gw.corp/gemini/v1beta/models"],
    ["https://gw.corp/gemini/v1", "https://gw.corp/gemini/v1/models"],
    ["https://gw.corp/gemini/v1beta/models", "https://gw.corp/gemini/v1beta/models"],
    ["https://gw.corp/gemini/v1/models", "https://gw.corp/gemini/v1/models"],
  ])("normalizes %s to the models collection %s", (input, expected) => {
    expect(resolveBaseUrl(input, "translate")).toBe(expected);
  });

  it("trims surrounding whitespace from a pasted value", () => {
    expect(resolveBaseUrl("  https://gw.corp  ", "translate")).toBe("https://gw.corp/v1beta/models");
  });

  it("strips trailing slashes so the appended model segment cannot double up", () => {
    expect(resolveBaseUrl("https://gw.corp/v1beta/models//", "translate")).toBe("https://gw.corp/v1beta/models");
  });

  it("falls back to the manifest default when the preference is empty or blank", () => {
    const fallback = getPreferenceDefault("geminiApiBaseUrl");
    const resolvedFallback = resolveBaseUrl(fallback, "translate");
    expect(resolvedFallback).toMatch(/\/v1beta\/models$/u);
    expect(resolveBaseUrl("", "translate")).toBe(resolvedFallback);
    expect(resolveBaseUrl("   ", "translate")).toBe(resolvedFallback);
    expect(resolveBaseUrl(undefined, "translate")).toBe(resolvedFallback);
  });

  describe("plaintext http is limited to true loopback", () => {
    it.each([
      "http://localhost:4000",
      "http://127.0.0.1:8080",
      "http://[::1]",
      // The bind address a local proxy is usually started with; as a destination
      // the kernel keeps it on this host.
      "http://0.0.0.0:4000",
    ])("accepts %s", (url) => {
      expect(resolveBaseUrl(url, "translate")).toBe(`${url}/v1beta/models`);
    });

    it("rejects http to a routable host, which would send the API key in cleartext", () => {
      expectRejected("http://gw.corp/v1beta/models");
    });

    it("rejects a hostname that merely starts with localhost", () => {
      expectRejected("http://localhost.evil.com/v1beta/models");
    });

    it("rejects private LAN addresses, which are not loopback", () => {
      expectRejected("http://192.168.1.50:4000/v1beta/models");
      expectRejected("http://mac-mini.local:4000/v1beta/models");
    });
  });

  it("rejects a value that is not a URL", () => {
    expectRejected("gw.corp/v1beta/models");
    expectRejected("not a url");
  });

  it("rejects schemes other than http and https even though they parse", () => {
    expectRejected("javascript:alert(1)");
    expectRejected("file:///etc/passwd");
    expectRejected("ftp://gw.corp/v1beta/models");
  });

  // `?…`/`#…` parse cleanly but swallow the appended `/{model}:generateContent`,
  // so the POST would silently land on the base path instead of the model.
  it("rejects a query string, which would swallow the appended model segment", () => {
    expectRejected("https://gw.corp/v1beta/models?key=abc123");
    expectRejected("https://gw.corp/v1beta/models?");
  });

  it("rejects a fragment, which fetch drops along with the model segment", () => {
    expectRejected("https://gw.corp/v1beta/models#section");
  });

  it("tags the failure with the calling surface so the toast routes correctly", () => {
    try {
      resolveBaseUrl("http://gw.corp/v1beta/models", "tts");
      throw new Error("expected rejection");
    } catch (err) {
      expect(isGeminiError(err)).toBe(true);
      if (isGeminiError(err)) expect(err.cause.surface).toBe("tts");
    }
  });

  it("permits https with userinfo so basic-auth proxies stay usable", () => {
    const url = "https://user:pass@gw.corp";
    expect(resolveBaseUrl(url, "translate")).toBe(`${url}/v1beta/models`);
  });
});

describe("customEndpointHost", () => {
  it("returns nothing for the manifest default so default installs keep the original error copy", () => {
    const resolvedDefault = resolveBaseUrl(getPreferenceDefault("geminiApiBaseUrl"), "translate");
    expect(customEndpointHost(resolvedDefault)).toBeUndefined();
  });

  it("returns host and port for a configured endpoint", () => {
    expect(customEndpointHost("https://gw.corp:8443/gemini/v1beta/models")).toBe("gw.corp:8443");
  });

  it("never carries the path or userinfo into user-visible error copy", () => {
    expect(customEndpointHost("https://user:pass@gw.corp/k/SECRET123/v1beta/models")).toBe("gw.corp");
  });

  it("treats a loopback endpoint as custom", () => {
    expect(customEndpointHost("http://localhost:4000/v1beta/models")).toBe("localhost:4000");
  });
});

describe("hostForLog", () => {
  it("drops the path so a path-embedded credential cannot reach the log", () => {
    expect(hostForLog("https://gw.corp/k/SECRET123/v1beta/models")).toBe("gw.corp");
  });

  it("drops userinfo credentials", () => {
    expect(hostForLog("https://user:pass@gw.corp/v1beta/models")).toBe("gw.corp");
  });

  it("keeps the port, which distinguishes local proxies", () => {
    expect(hostForLog("http://localhost:4000/v1beta/models")).toBe("localhost:4000");
  });

  it("degrades to a placeholder rather than throwing inside a log call", () => {
    expect(hostForLog("not a url")).toBe("invalid");
  });
});
