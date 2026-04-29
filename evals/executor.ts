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
};

export async function runCase(
  c: EvalCase,
  apiKey: string,
  options?: ExecutorOptions,
): Promise<CaseRunResult[]> {
  const runs = options?.runs ?? SCORING_RUNS_PER_CASE;
  const temperature = options?.temperature ?? SCORING_TEMPERATURE;
  const languagePair = c.languagePair ?? DEFAULT_LANGUAGE_PAIR;
  const seed = seedFromInput(c.input);

  const results: CaseRunResult[] = [];
  for (let i = 0; i < runs; i++) {
    try {
      const output = await translateWordRaw(c.input, apiKey, languagePair, undefined, {
        temperature,
        seed,
      });
      results.push({ kind: "ok", output });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ kind: "error", message });
    }
  }
  return results;
}
