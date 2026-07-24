import { geminiError, type GeminiErrorSurface } from "./geminiError";
import { getPreferenceDefault } from "./manifest";

/**
 * Resolution and validation for the user-configurable Gemini API base URL.
 *
 * The preference holds everything up to the model segment — including the API
 * version and the `models` collection — so a proxy can be mounted at any path
 * and the caller only appends `/{model}:generateContent`.
 *
 * The endpoint is user-controlled but the API key is not: it travels to
 * whatever host is configured. Plaintext `http` is therefore accepted only for
 * true loopback, where the request never reaches a network interface.
 */

// `new URL("http://[::1]:4000").hostname` keeps the brackets — matching without
// them silently rejects IPv6 loopback. `0.0.0.0` is the bind address local
// proxies are usually started with, and users type back what they bound; as a
// destination the kernel routes it to this host, so the request stays local.
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

function normalize(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

function isAllowedOrigin(url: URL): boolean {
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTNAMES.has(url.hostname);
}

/**
 * Normalize and validate the configured base URL, falling back to the manifest
 * default when the preference is empty. Throws `invalid-base-url` rather than
 * returning a sentinel so a misconfigured endpoint can never reach `fetch`.
 */
export function resolveBaseUrl(raw: string | undefined, surface: GeminiErrorSurface): string {
  const candidate = normalize(raw ?? "") || normalize(getPreferenceDefault("geminiApiBaseUrl"));

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw geminiError({ domain: "infrastructure", kind: "invalid-base-url", surface });
  }

  if (!isAllowedOrigin(url)) {
    throw geminiError({ domain: "infrastructure", kind: "invalid-base-url", surface });
  }

  // A query string or fragment swallows the appended `/{model}:generateContent`,
  // silently POSTing to the base path instead. `?key=…` is the shape Google's
  // own older snippets use, so it is a likely paste — and it puts a secret in a URL.
  // Tested on the raw string, not `url.search`/`url.hash`: a trailing `?` parses
  // to an empty search yet still truncates the path at concatenation time.
  if (candidate.includes("?") || candidate.includes("#")) {
    throw geminiError({ domain: "infrastructure", kind: "invalid-base-url", surface });
  }

  return candidate;
}

/**
 * Host to name when a request to a user-configured endpoint fails ambiguously.
 * `undefined` for the manifest default, which keeps the error copy unchanged
 * for installs that never touched the preference. Built from `hostForLog`, so
 * no path or userinfo can reach user-visible text.
 */
export function customEndpointHost(resolvedBaseUrl: string): string | undefined {
  if (resolvedBaseUrl === normalize(getPreferenceDefault("geminiApiBaseUrl"))) return undefined;
  return hostForLog(resolvedBaseUrl);
}

/**
 * Host for structured logs. `URL.host` drops the path and any `user:pass@`
 * userinfo, so a credential embedded in either cannot reach the log.
 */
export function hostForLog(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "invalid";
  }
}
