import { translateWordRaw } from "../src/lib/gemini";
import type { LanguagePair } from "../src/lib/languages";
import type { CaseRunResult, EvalCase } from "./types";

export const DEFAULT_LANGUAGE_PAIR: LanguagePair = {
  source: { code: "en", name: "English" },
  target: { code: "uk", name: "Ukrainian" },
};

export const SCORING_RUNS_PER_CASE = 3;
export const SCORING_TEMPERATURE = 0;

/** FNV-1a 32-bit hash. Stable, dependency-free, fits in a uint32 for the Gemini seed. */
export function seedFromInput(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type ExecutorOptions = {
  runs?: number;
  temperature?: number;
  onRun?: (result: CaseRunResult, index: number, durationMs: number) => void;
};

export async function runCase(
  c: EvalCase,
  apiKey: string,
  options?: ExecutorOptions,
): Promise<CaseRunResult[]> {
  const runs = options?.runs ?? SCORING_RUNS_PER_CASE;
  const temperature = options?.temperature ?? SCORING_TEMPERATURE;
  const languagePair = c.languagePair ?? DEFAULT_LANGUAGE_PAIR;
  const baseSeed = seedFromInput(c.input);

  const results: CaseRunResult[] = [];
  for (let i = 0; i < runs; i++) {
    const start = Date.now();
    let result: CaseRunResult;
    try {
      const output = await translateWordRaw(c.input, apiKey, languagePair, undefined, {
        temperature,
        seed: baseSeed + i,
      });
      result = { kind: "ok", output };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const cause = err instanceof Error && err.cause !== undefined ? err.cause : undefined;
      result = { kind: "error", message, cause };
    }
    results.push(result);
    options?.onRun?.(result, i, Date.now() - start);
  }
  return results;
}
