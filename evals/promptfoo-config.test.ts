import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const transformVars = require("./promptfoo/transform-vars.cjs") as (vars: Record<string, unknown>) => {
  expectJson: string;
};

describe("Promptfoo rubric variables", () => {
  it("serializes expected fields before rendering the LLM judge rubric", () => {
    const result = transformVars({
      expect: {
        status: "ok",
        targetScript: "Cyrillic",
        partOfSpeechAny: ["idiom", "expression"],
      },
    });

    expect(result.expectJson).toContain('"status": "ok"');
    expect(result.expectJson).toContain('"targetScript": "Cyrillic"');
    expect(result.expectJson).toContain('"partOfSpeechAny"');
    expect(result.expectJson).not.toBe("[object Object]");
  });

  it("uses the serialized expectations var in the promptfoo config", () => {
    const config = readFileSync(join(import.meta.dirname, "promptfooconfig.yaml"), "utf8");

    expect(config).toContain("transformVars: file://promptfoo/transform-vars.cjs");
    expect(config).toContain("{{expectJson}}");
    expect(config).not.toContain("{{expect}}\n");
  });
});

describe("Promptfoo npm scripts", () => {
  it("wires eval and publish to the single rubric config", () => {
    const packageJson = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.eval).toContain("-c evals/promptfooconfig.yaml");
    expect(packageJson.scripts.eval).not.toContain("promptfooconfig.full.yaml");
    expect(packageJson.scripts["eval:full"]).toBeUndefined();
    expect(packageJson.scripts.publish).toMatch(/^npm run eval && /);
  });

  it("relaxes the pass-rate threshold to 85% to absorb judge flakiness", () => {
    // The eval suite runs an llm-rubric judged by gemini-2.5-pro, which returns
    // 503 UNAVAILABLE under demand. Until a sturdier retry / re-judge strategy is
    // in place, the threshold sits at 85% so a single judge flake doesn't fail
    // the whole run. Tighten back toward 100% once the judge layer is reliable.
    const packageJson = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.eval).toContain("PROMPTFOO_PASS_RATE_THRESHOLD=85");
    expect(packageJson.scripts["eval:smoke"]).toContain("PROMPTFOO_PASS_RATE_THRESHOLD=85");
  });

  it("samples a fixed-size random subset for smoke instead of partitioning the case list", () => {
    // Smoke is a quick local-iteration loop, not an exhaustive gate. Random sampling
    // means new test cases don't need a "smoke or full?" decision and each run
    // exercises a different slice over time. Full coverage comes from `npm run eval`.
    const packageJson = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["eval:smoke"]).toContain("--filter-sample 10");
    expect(packageJson.scripts.eval).not.toContain("--filter-sample");
  });
});
