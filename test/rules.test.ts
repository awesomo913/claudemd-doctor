import { describe, expect, it } from "vitest";
import { checkReferences, extractAnchors, splitIntoRules } from "../src/doctor/rules.js";

describe("splitIntoRules", () => {
  it("splits bullets under headings and folds indented continuation lines", () => {
    const content = [
      "# Heading One",
      "- First rule about `widget.ts`",
      "- Second rule",
      "  continues here",
      "",
      "## Heading Two",
      "A plain paragraph rule under a heading.",
      "Still the same paragraph.",
    ].join("\n");

    const rules = splitIntoRules(content, "FIXTURE.md");
    expect(rules).toHaveLength(3);
    expect(rules[0]?.heading).toBe("Heading One");
    expect(rules[0]?.text).toContain("widget.ts");
    expect(rules[1]?.text).toBe("Second rule continues here");
    expect(rules[2]?.heading).toBe("Heading Two");
    expect(rules[2]?.text).toBe("A plain paragraph rule under a heading. Still the same paragraph.");
  });

  it("ignores blank lines and does not emit a rule for headings themselves", () => {
    const content = "# Just a heading\n\n\n- one rule";
    const rules = splitIntoRules(content, "FIXTURE.md");
    expect(rules).toHaveLength(1);
    expect(rules[0]?.text).toBe("one rule");
  });

  it("records 1-indexed line numbers", () => {
    const content = "# H\n- line two rule";
    const rules = splitIntoRules(content, "FIXTURE.md");
    expect(rules[0]?.line).toBe(2);
  });
});

describe("extractAnchors", () => {
  it("extracts backticked tokens, quoted phrases, ALL_CAPS words, filenames and paths", () => {
    const text = 'Always run `npm test` before editing CONFIG.md, see also "do the thing" and src/core/paths.ts';
    const anchors = extractAnchors(text);
    expect(anchors).toContain("npm test");
    expect(anchors).toContain("do the thing");
    expect(anchors).toContain("CONFIG.md");
    expect(anchors.some((a) => a.includes("paths.ts"))).toBe(true);
  });

  it("drops anchors that are too short to be distinctive", () => {
    const anchors = extractAnchors("use `a` or `ok` here");
    expect(anchors).not.toContain("a");
  });

  it("returns an empty list for text with no distinctive anchors", () => {
    expect(extractAnchors("just some ordinary prose with no special tokens")).toEqual([]);
  });
});

describe("checkReferences", () => {
  it("is case-insensitive and reports per-anchor match status", () => {
    const corpus = "I ran NPM Test and it passed.";
    const results = checkReferences(["npm test", "never seen anchor"], corpus);
    expect(results.find((r) => r.anchor === "npm test")?.referenced).toBe(true);
    expect(results.find((r) => r.anchor === "never seen anchor")?.referenced).toBe(false);
  });
});
