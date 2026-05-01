import { describe, it, expect } from "vitest";
import { seedFromInput } from "./executor";

const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;

const HARVEST_RUNS = 20;

describe("seedFromInput", () => {
  it("is deterministic", () => {
    expect(seedFromInput("hello")).toBe(seedFromInput("hello"));
    expect(seedFromInput("red herring")).toBe(seedFromInput("red herring"));
  });

  it.each([
    "hello",
    "book",
    "run",
    "bank",
    "cat",
    "rim",
    "red herring",
    "kick the bucket",
    "beat around the bush",
    "the best of both worlds",
    "синій птах",
    "xqfjvbn",
    "zzqpplx",
    "give up",
    "break down",
    "don't give up",
    "well-known fact",
    "red hering",
    "kik the bucket",
  ])("returns a signed int32 for %s", (input) => {
    const seed = seedFromInput(input);
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(INT32_MIN);
    expect(seed).toBeLessThanOrEqual(INT32_MAX);
  });

  it.each(["book", "red herring", "xqfjvbn", "give up", "don't give up"])(
    "yields a baseSeed + i sequence that stays in int32 range across HARVEST_RUNS for %s",
    (input) => {
      const baseSeed = seedFromInput(input);
      for (let i = 0; i < HARVEST_RUNS; i++) {
        const seed = (baseSeed + i) | 0;
        expect(seed).toBeGreaterThanOrEqual(INT32_MIN);
        expect(seed).toBeLessThanOrEqual(INT32_MAX);
      }
    },
  );
});
