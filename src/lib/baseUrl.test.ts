import { describe, it, expect } from "vitest";
import { hostForLog, resolveBaseUrl } from "./baseUrl";
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
  it("returns an https URL unchanged", () => {
    expect(resolveBaseUrl("https://gw.corp/gemini/v1beta/models", "translate")).toBe(
      "https://gw.corp/gemini/v1beta/models",
    );
  });

  it("trims surrounding whitespace from a pasted value", () => {
    expect(resolveBaseUrl("  https://gw.corp/v1beta/models  ", "translate")).toBe("https://gw.corp/v1beta/models");
  });

  it("strips trailing slashes so the appended model segment cannot double up", () => {
    expect(resolveBaseUrl("https://gw.corp/v1beta/models//", "translate")).toBe("https://gw.corp/v1beta/models");
  });

  it("falls back to the manifest default when the preference is empty or blank", () => {
    const fallback = getPreferenceDefault("geminiApiBaseUrl");
    expect(resolveBaseUrl("", "translate")).toBe(fallback);
    expect(resolveBaseUrl("   ", "translate")).toBe(fallback);
    expect(resolveBaseUrl(undefined, "translate")).toBe(fallback);
  });

  it("accepts the manifest default itself", () => {
    const fallback = getPreferenceDefault("geminiApiBaseUrl");
    expect(resolveBaseUrl(fallback, "translate")).toBe(fallback);
  });

  describe("plaintext http is limited to true loopback", () => {
    it.each([
      "http://localhost:4000/v1beta/models",
      "http://127.0.0.1:8080/v1beta/models",
      "http://[::1]/v1beta/models",
    ])("accepts %s", (url) => {
      expect(resolveBaseUrl(url, "translate")).toBe(url);
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
    const url = "https://user:pass@gw.corp/v1beta/models";
    expect(resolveBaseUrl(url, "translate")).toBe(url);
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
