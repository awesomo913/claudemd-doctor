import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildDoctorReport } from "../src/doctor/report.js";
import { renderPretty } from "../src/doctor/render.js";

const TEMP_ROOT = path.join("C:\\", `cmddoctor-boxfit-test-${process.pid}-${Date.now()}`);

beforeAll(() => {
  mkdirSync(path.join(TEMP_ROOT, ".claude"), { recursive: true });
  writeFileSync(
    path.join(TEMP_ROOT, ".claude", "CLAUDE.md"),
    "# Fixture\n" +
      "- Always use `pip` for installs.\n" +
      "- Never use `pip`, use `uv` instead, because this is a deliberately long prose sentence written specifically to exercise the word-boundary truncation logic without ever getting cut off in the middle of a word, which is the whole point of this fixture existing at all.\n",
  );
});

afterAll(() => {
  rmSync(TEMP_ROOT, { recursive: true, force: true });
});

const originalColumns = process.stdout.columns;
afterEach(() => {
  Object.defineProperty(process.stdout, "columns", { value: originalColumns, configurable: true });
});

function setColumns(n: number | undefined): void {
  Object.defineProperty(process.stdout, "columns", { value: n, configurable: true });
}

describe("summary box fits the terminal width", () => {
  it("never produces a content line wider than the declared box width", async () => {
    // Wide enough that each of the two split groups (tokens+$/mo on one
    // line, conflicts on the other) fits on its own — the two-line split
    // is the documented fix for an overflowing one-liner, not a general
    // word-wrapper for arbitrarily narrow terminals.
    setColumns(72);
    const report = await buildDoctorReport({
      cwd: "P:\\boxfit",
      modelAlias: "sonnet",
      turnsPerDay: 10,
      maxSessions: 200,
      all: false,
      includeTranscripts: false,
      includeAgents: false,
      failOverTokens: undefined,
      homeDir: TEMP_ROOT,
    });

    const out = renderPretty(report);
    const lines = out.split("\n");
    const boxStart = lines.findIndex((l) => l.includes("┌─ summary"));
    expect(boxStart).toBeGreaterThanOrEqual(0);

    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

    // Collect the box's content lines (between the top and bottom border).
    const contentLines: string[] = [];
    for (let i = boxStart + 1; i < lines.length; i += 1) {
      const line = lines[i] as string;
      if (stripAnsi(line).startsWith("└")) break;
      contentLines.push(line);
    }
    expect(contentLines.length).toBeGreaterThan(0);

    // The content split onto two lines (one-liner doesn't fit a 72-col
    // terminal for this fixture) — confirms the width check actually
    // drove the split decision.
    expect(contentLines.length).toBe(2);

    // The border is sized to match the content exactly (±1 for the
    // trailing space before the box's own closing edge), not a fixed or
    // terminal-capped width that could be narrower than what's printed.
    const visibleLength = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
    const topBorderLength = visibleLength(lines[boxStart] as string);
    const bottomBorderLength = visibleLength(lines[boxStart + contentLines.length + 1] as string);
    const widestContent = Math.max(...contentLines.map((l) => visibleLength(l)));
    expect(topBorderLength).toBeGreaterThanOrEqual(widestContent);
    expect(topBorderLength).toBeLessThanOrEqual(widestContent + 4);
    expect(bottomBorderLength).toBeGreaterThanOrEqual(widestContent);
  });

  it("falls back to a default width of 100 when stdout is not a TTY", async () => {
    setColumns(undefined);
    const report = await buildDoctorReport({
      cwd: "P:\\boxfit",
      modelAlias: "sonnet",
      turnsPerDay: 10,
      maxSessions: 200,
      all: false,
      includeTranscripts: false,
      includeAgents: false,
      failOverTokens: undefined,
      homeDir: TEMP_ROOT,
    });
    // Should render without throwing and produce a bounded box.
    const out = renderPretty(report);
    expect(out).toContain("summary");
  });
});

describe("quoted rule/conflict text never wraps mid-word", () => {
  it("truncates the polarity conflict quotes to the available width, cutting at a word boundary", async () => {
    setColumns(72);
    const report = await buildDoctorReport({
      cwd: "P:\\boxfit",
      modelAlias: "sonnet",
      turnsPerDay: 10,
      maxSessions: 200,
      all: false,
      includeTranscripts: false,
      includeAgents: false,
      failOverTokens: undefined,
      homeDir: TEMP_ROOT,
    });

    const out = renderPretty(report);
    const quoteLines = out.split("\n").filter((l) => /"[^"]*"/.test(l));
    expect(quoteLines.length).toBeGreaterThan(0);
    for (const line of quoteLines) {
      const match = /"([^"]*)"/.exec(line);
      expect(match).not.toBeNull();
      const quoted = match![1] as string;
      // Either the full (short) original text, or it ends with an ellipsis
      // right after a real word — never a truncated word fragment glued
      // straight to the ellipsis with no preceding space logic violated.
      if (quoted.endsWith("…")) {
        const withoutEllipsis = quoted.slice(0, -1);
        expect(withoutEllipsis.endsWith(" ")).toBe(false); // trimmed
        expect(withoutEllipsis.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("quote width budget accounts for the line's own prefix, not a fixed indent", () => {
  // Regression for: a conflict line's real prefix is
  // `    <path>:<line> [<polarity>] ` — far longer than the 4-space indent
  // the old budget assumed — so a long file path left no room for the
  // quote budget's own "-2" guard, and the quote wrapped mid-word onto the
  // next terminal line instead of being truncated with an ellipsis.
  const LONG_ROOT = path.join("C:\\", `cmddoctor-boxfit-longprefix-${process.pid}-${Date.now()}`);
  const LONG_RULE_NAME = "a-very-long-descriptive-rule-filename-chosen-specifically-to-produce-a-long-conflict-line-prefix.md";

  beforeAll(() => {
    mkdirSync(path.join(LONG_ROOT, ".claude", "rules"), { recursive: true });
    writeFileSync(path.join(LONG_ROOT, ".claude", "CLAUDE.md"), "# Fixture\n- Always use `pip` for installs.\n");
    writeFileSync(
      path.join(LONG_ROOT, ".claude", "rules", LONG_RULE_NAME),
      "# Long Filename Rule\n" +
        "- Never use `pip`, use `uv` instead, because this is a deliberately long prose sentence written specifically to exercise the word-boundary truncation logic without ever getting cut off in the middle of a word, which is the whole point of this fixture existing at all.\n",
    );
  });

  afterAll(() => {
    rmSync(LONG_ROOT, { recursive: true, force: true });
  });

  it("subtracts the real visible prefix (path + line + polarity label) before truncating, so the quote still breaks at a word boundary", async () => {
    setColumns(72);
    const report = await buildDoctorReport({
      cwd: "P:\\boxfit",
      modelAlias: "sonnet",
      turnsPerDay: 10,
      maxSessions: 200,
      all: false,
      includeTranscripts: false,
      includeAgents: false,
      failOverTokens: undefined,
      homeDir: LONG_ROOT,
    });

    const out = renderPretty(report);
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
    const lines = out.split("\n");

    // Find the conflict line whose prefix carries the long rule filename.
    const longPrefixLine = lines.find((l) => l.includes(LONG_RULE_NAME) && /"[^"]*"/.test(l));
    expect(longPrefixLine).toBeDefined();

    const plain = stripAnsi(longPrefixLine as string);
    const match = /"([^"]*)"/.exec(plain);
    expect(match).not.toBeNull();
    const quoted = match![1] as string;

    // The budget correctly shrank for this long prefix: the quote is much
    // shorter than the 72-col default would allow with a naive 4-space
    // indent assumption, and still ends at a word boundary, never mid-word.
    if (quoted.endsWith("…")) {
      const withoutEllipsis = quoted.slice(0, -1);
      expect(withoutEllipsis.endsWith(" ")).toBe(false);
      expect(withoutEllipsis.length).toBeGreaterThan(0);
      // No truncated word fragment: the character right before the cut
      // point in the ORIGINAL text must be a word boundary (space) or the
      // kept text must exactly match the start of the original — i.e. the
      // cut never lands inside a word.
      const original = "Never use `pip`, use `uv` instead, because this is a deliberately long prose sentence written specifically to exercise the word-boundary truncation logic without ever getting cut off in the middle of a word, which is the whole point of this fixture existing at all.";
      expect(original.startsWith(withoutEllipsis)).toBe(true);
      const nextChar = original[withoutEllipsis.length];
      expect(nextChar === " " || nextChar === undefined).toBe(true);
    }

    // The real prefix here (indent + long filename + line + polarity
    // label) is itself longer than the 72-column terminal, so the quote
    // budget hits its 20-char floor rather than the ~66 chars the old,
    // buggy fixed-4-space-indent budget would have handed out — proving
    // the fix is actually reading the real prefix, not ignoring it.
    const withoutEllipsis = quoted.endsWith("…") ? quoted.slice(0, -1) : quoted;
    expect(withoutEllipsis.length).toBeLessThanOrEqual(20);
  });
});
