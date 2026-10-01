import { describe, expect, it } from "vitest";
import { splitIntoRules } from "../src/doctor/rules.js";
import { findConflicts, findDuplicates, findPolarityConflicts } from "../src/doctor/conflicts.js";

describe("findDuplicates", () => {
  it("flags near-identical rules written in two different files", () => {
    const rulesA = splitIntoRules("- Always commit using the conventional commit format for every change", "A.md");
    const rulesB = splitIntoRules("- Always commit using the conventional commit message format for every change", "B.md");
    const dups = findDuplicates([...rulesA, ...rulesB]);
    expect(dups).toHaveLength(1);
    expect(dups[0]?.similarity).toBeGreaterThanOrEqual(0.85);
  });

  it("does not flag unrelated rules, even when both clear the prose-word floor", () => {
    const rulesA = splitIntoRules(
      "- Never commit secrets or credentials of any kind to the shared repository",
      "A.md",
    );
    const rulesB = splitIntoRules(
      "- Always write small, clearly named, single purpose helper functions for every module",
      "B.md",
    );
    const dups = findDuplicates([...rulesA, ...rulesB]);
    expect(dups).toHaveLength(0);
  });

  it("skips very short rules to avoid trivial false positives", () => {
    const rulesA = splitIntoRules("- Use uv", "A.md");
    const rulesB = splitIntoRules("- Use uv", "B.md");
    const dups = findDuplicates([...rulesA, ...rulesB]);
    expect(dups).toHaveLength(0);
  });

  it("ignores lines that are mostly code/paths, like a template-path table row", () => {
    const rulesA = splitIntoRules(
      "- `src/core/paths.ts` `src/core/tokens.ts` `src/core/pricing.ts` `src/doctor/report.ts`",
      "A.md",
    );
    const rulesB = splitIntoRules(
      "- `src/doctor/render.ts` `src/doctor/rules.ts` `src/doctor/conflicts.ts` `src/cli.ts`",
      "B.md",
    );
    const dups = findDuplicates([...rulesA, ...rulesB]);
    expect(dups).toHaveLength(0);
  });
});

describe("findPolarityConflicts", () => {
  it("flags a shared anchor used with opposite polarity", () => {
    const rulesA = splitIntoRules("- Always use `pip install` for Python packages", "A.md");
    const rulesB = splitIntoRules("- Never use `pip install`, use uv instead", "B.md");
    const conflicts = findPolarityConflicts([...rulesA, ...rulesB]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.anchor).toBe("pip install");
    expect([conflicts[0]?.a.polarity, conflicts[0]?.b.polarity].sort()).toEqual(["negative", "positive"]);
  });

  it("does not flag two rules that agree in polarity", () => {
    const rulesA = splitIntoRules("- Always use `pip install` for Python packages", "A.md");
    const rulesB = splitIntoRules("- You must use `pip install` in CI too", "B.md");
    const conflicts = findPolarityConflicts([...rulesA, ...rulesB]);
    expect(conflicts).toHaveLength(0);
  });

  it("treats a leading ❌ anti-pattern marker as negative for the whole bullet, even past a trailing 'always'", () => {
    // Real false-positive found on a live instruction chain: an anti-pattern
    // bullet phrased "❌ do X — always do Y instead" was misread as
    // POSITIVE toward the shared path anchor because "always" sits right
    // next to it, conflicting with an unrelated, genuinely negative rule
    // about a different aspect of the same path.
    const rulesA = splitIntoRules("- **Never** ship raw output to `shared/output/` directly", "A.md");
    const rulesB = splitIntoRules("- ❌ Output to `dist/` and forget — always move to `shared/output/`", "B.md");
    const conflicts = findPolarityConflicts([...rulesA, ...rulesB]);
    expect(conflicts).toHaveLength(0);
  });

  it("reports file:line locations for both sides", () => {
    const rulesA = splitIntoRules("- Always use `rtk` for discovery greps", "A.md");
    const rulesB = splitIntoRules("# h\n- Never use `rtk` for exhaustive audits", "B.md");
    const conflicts = findPolarityConflicts([...rulesA, ...rulesB]);
    expect(conflicts[0]?.a.file).toBe("A.md");
    expect(conflicts[0]?.b.file).toBe("B.md");
    expect(conflicts[0]?.b.line).toBe(2);
  });
});

describe("findConflicts", () => {
  it("combines duplicate and polarity findings", () => {
    const content = [
      "- Always use `foo-cli` to deploy",
      "- Never use `foo-cli` to deploy",
    ].join("\n");
    const rules = splitIntoRules(content, "A.md");
    const all = findConflicts(rules);
    expect(all.some((f) => f.kind === "polarity")).toBe(true);
  });
});
