type LogLevel = "debug" | "info" | "warn" | "error";
type LogValue = string | number | boolean | undefined | null | LogValue[] | { [key: string]: LogValue };

export type LogFields = Record<string, unknown>;

type LoggerOptions = {
  enabled?: boolean;
};

const SENSITIVE_KEY_RE =
  /^(api[-_]?key|authorization|body|clipboard|input|password|prompt|raw|secret|text|token|word)$/i;
const MAX_STRING_LENGTH = 240;

function isLogEnabled(options?: LoggerOptions): boolean {
  return options?.enabled ?? process.env.NODE_ENV !== "test";
}

function nowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function sanitizeValue(key: string, value: unknown, depth = 0): LogValue {
  if (SENSITIVE_KEY_RE.test(key)) return "[redacted]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) return { name: value.name };
  if (Array.isArray(value)) {
    if (depth >= 2) return "[array]";
    return value.slice(0, 10).map((item) => sanitizeValue(key, item, depth + 1));
  }
  if (typeof value === "object") {
    if (depth >= 2) return "[object]";
    const out: Record<string, LogValue> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      out[childKey] = sanitizeValue(childKey, childValue, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function sanitizeLogFields(fields: LogFields = {}): Record<string, LogValue> {
  const sanitized: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) sanitized[key] = sanitizeValue(key, value);
  }
  return sanitized;
}

export function createLogger(scope: string, options?: LoggerOptions) {
  function write(level: LogLevel, event: string, fields?: LogFields) {
    if (!isLogEnabled(options)) return;
    const log = console[level];
    log(`[${scope}] ${event}`, sanitizeLogFields(fields));
  }

  return {
    debug: (event: string, fields?: LogFields) => write("debug", event, fields),
    info: (event: string, fields?: LogFields) => write("info", event, fields),
    warn: (event: string, fields?: LogFields) => write("warn", event, fields),
    error: (event: string, fields?: LogFields) => write("error", event, fields),
    timer: () => {
      const startedAt = nowMs();
      return () => Math.round(nowMs() - startedAt);
    },
  };
}
