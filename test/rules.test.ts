import { describe, expect, it } from "vitest";
import {
  checkReferences,
  extractAnchors,
  extractTechnicalAnchors,
  findAnchorsPresentInCorpus,
  splitIntoRules,
} from "../src/doctor/rules.js";

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

  it("drops generic ALL_CAPS structural words that are not real anchors", () => {
    const anchors = extractAnchors("This is a HOT rule that applies to ALL cases AND every API call.");
    expect(anchors).not.toContain("HOT");
    expect(anchors).not.toContain("ALL");
    expect(anchors).not.toContain("AND");
    expect(anchors).not.toContain("API");
  });
});

describe("extractTechnicalAnchors", () => {
  it("keeps backticked single words, filenames, and paths", () => {
    const anchors = extractTechnicalAnchors("Always use `pip` and read src/core/paths.ts before editing CONFIG.md");
    expect(anchors).toContain("pip");
    expect(anchors).toContain("CONFIG.md");
    expect(anchors.some((a) => a.includes("paths.ts"))).toBe(true);
  });

  it("drops bare ALL_CAPS words and quoted prose phrases entirely, even backticked ones", () => {
    const anchors = extractTechnicalAnchors('This is a HOT rule. See also "do the thing" and `ALL` cases.');
    expect(anchors).not.toContain("HOT");
    expect(anchors).not.toContain("do the thing");
    expect(anchors).not.toContain("ALL");
  });

  it("drops a multi-word backticked phrase if any word in it is generic", () => {
    const anchors = extractTechnicalAnchors("Run `npm all` before pushing");
    expect(anchors).not.toContain("npm all");
  });
});

describe("findAnchorsPresentInCorpus (speed fix: Aho-Corasick, one pass instead of one .includes() per anchor)", () => {
  it("finds every anchor actually present and none that aren't, matching per-anchor .includes() semantics", () => {
    const anchors = ["npm test", "pip install", "never seen anchor"];
    const corpus = "i ran npm test and it passed, then ran pip install too";
    const found = findAnchorsPresentInCorpus(anchors, corpus);
    expect(found.has("npm test")).toBe(true);
    expect(found.has("pip install")).toBe(true);
    expect(found.has("never seen anchor")).toBe(false);
  });

  it("still finds a shorter anchor that is a pure substring of a longer one also present (overlap correctness)", () => {
    // This is the exact case a naive non-overlapping scan (or a regex
    // alternation that stops at the first match per position) can miss:
    // "foo" only ever occurs inside "foobar" in this corpus, never alone.
    const anchors = ["foo", "foobar"];
    const corpus = "the command is foobar when run standalone";
    const found = findAnchorsPresentInCorpus(anchors, corpus);
    expect(found.has("foobar")).toBe(true);
    expect(found.has("foo")).toBe(true);
  });

  it("handles an empty anchor list and an empty corpus without throwing", () => {
    expect(findAnchorsPresentInCorpus([], "something")).toEqual(new Set());
    expect(findAnchorsPresentInCorpus(["x"], "")).toEqual(new Set());
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
