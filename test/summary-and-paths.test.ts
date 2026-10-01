import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDoctorReport } from "../src/doctor/report.js";
import { renderJson, renderMarkdown, renderPretty } from "../src/doctor/render.js";

const TEMP_ROOT = path.join("C:\\", `cmddoctor-summary-test-${process.pid}-${Date.now()}`);
const SCOPED_FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "claude-projects-scoped",
);

beforeAll(() => {
  mkdirSync(path.join(TEMP_ROOT, ".claude"), { recursive: true });
  writeFileSync(
    path.join(TEMP_ROOT, ".claude", "CLAUDE.md"),
    "# Fixture\n- Always use `pip` for installs.\n- Never use `pip`, use `uv` instead.\n",
  );
});

afterAll(() => {
  rmSync(TEMP_ROOT, { recursive: true, force: true });
});

describe("report.summary (headline block)", () => {
  it("includes chain tokens, conflict count, and a cached/uncached monthly figure even with transcripts skipped", async () => {
    const report = await buildDoctorReport({
      cwd: "P:\\scoped",
      modelAlias: "sonnet",
      turnsPerDay: 10,
      maxSessions: 200,
      all: false,
      includeTranscripts: false,
      includeAgents: false,
      failOverTokens: undefined,
      homeDir: TEMP_ROOT,
    });

    expect(report.summary.chainTokens).toBe(report.totalTokens);
    expect(report.summary.conflictsCount).toBe(report.conflicts.length);
    expect(report.summary.conflictsCount).toBeGreaterThan(0); // the pip/uv fixture has a real conflict
    // No transcripts scanned -> falls back to the offline flat estimate, not "measured".
    expect(report.summary.monthlyCachedIsMeasured).toBe(false);
    expect(report.summary.monthlyCachedUsd).toBeCloseTo(report.cost!.perMonthCacheReadUsd, 6);
    expect(report.summary.monthlyUncachedUsd).toBeCloseTo(report.cost!.perMonthUncachedUsd, 6);
    expect(report.summary.neverReferencedPercent).toBeUndefined(); // transcripts skipped
  });

  it("uses the measured cache-read reality for the monthly figure when transcripts were scanned", async () => {
    const report = await buildDoctorReport({
      cwd: "P:\\scoped",
      modelAlias: "sonnet",
      turnsPerDay: 10,
      maxSessions: 200,
      all: false,
      includeTranscripts: true,
      includeAgents: false,
      failOverTokens: undefined,
      homeDir: TEMP_ROOT,
      projectsDir: SCOPED_FIXTURES_DIR,
    });

    expect(report.summary.monthlyCachedIsMeasured).toBe(true);
    expect(report.summary.monthlyCachedUsd).toBeGreaterThan(0);
    // Measured and flat-offline estimates are different calculations — on
    // this fixture they should not coincidentally match to 6 decimal places.
    expect(report.summary.monthlyCachedUsd).not.toBeCloseTo(report.cost!.perMonthCacheReadUsd, 6);
  });

  it("renders the summary in pretty, markdown, and JSON output", async () => {
    const report = await buildDoctorReport({
      cwd: "P:\\scoped",
      modelAlias: "sonnet",
      turnsPerDay: 10,
      maxSessions: 200,
      all: false,
      includeTranscripts: false,
      includeAgents: false,
      failOverTokens: undefined,
      homeDir: TEMP_ROOT,
    });

    const pretty = renderPretty(report);
    expect(pretty).toContain("re-sent every turn");
    expect(pretty).toContain("conflict");

    const markdown = renderMarkdown(report);
    expect(markdown).toContain("re-sent every turn");

    const json = JSON.parse(renderJson(report));
    expect(json.summary).toBeDefined();
    expect(json.summary.chainTokens).toBe(report.totalTokens);
    expect(json.summary.conflictsCount).toBe(report.conflicts.length);
  });
});

describe("path shortening in pretty/markdown (not JSON)", () => {
  it("shows home-dir paths as ~/... in pretty and markdown, but keeps full absolute paths in JSON", async () => {
    const report = await buildDoctorReport({
      cwd: "P:\\scoped",
      modelAlias: "sonnet",
      turnsPerDay: 10,
      maxSessions: 200,
      all: false,
      includeTranscripts: false,
      includeAgents: false,
      failOverTokens: undefined,
      homeDir: TEMP_ROOT,
    });

    const pretty = renderPretty(report);
    expect(pretty).toContain("~/.claude/CLAUDE.md");
    expect(pretty).not.toContain(TEMP_ROOT);

    const markdown = renderMarkdown(report);
    expect(markdown).toContain("~/.claude/CLAUDE.md");
    expect(markdown).not.toContain(TEMP_ROOT.replace(/\\/g, "\\\\"));

    const json = JSON.parse(renderJson(report));
    const userNode = json.tree.find((n: { kind: string }) => n.kind === "user-main");
    expect(userNode.filePath).toContain(TEMP_ROOT);
    expect(userNode.filePath).not.toMatch(/^~/);
  });
});
