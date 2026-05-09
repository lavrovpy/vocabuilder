import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Promptfoo rubric variables", () => {
  it("uses the serialized expectations var in the promptfoo config", () => {
    const config = readFileSync(join(import.meta.dirname, "promptfooconfig.yaml"), "utf8");

    expect(config).toContain("transformVars: file://promptfoo/transform-vars.cjs");
    expect(config).toContain("{{expectJson}}");
  });
});
