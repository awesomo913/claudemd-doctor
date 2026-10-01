import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDoctorReport } from "../src/doctor/report.js";

// Isolated home/cwd under the drive root so this never touches the real
// ~/.claude/CLAUDE.md on the dev machine (see discovery.test.ts for why).
const TEMP_ROOT = path.join("C:\\", `cmddoctor-report-test-${process.pid}-${Date.now()}`);

const SCOPED_FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "claude-projects-scoped",
);

beforeAll(() => {
  mkdirSync(TEMP_ROOT, { recursive: true });
  mkdirSync(path.join(TEMP_ROOT, ".claude"), { recursive: true });
  writeFileSync(path.join(TEMP_ROOT, "CLAUDE.md"), "# Fixture\n- A rule with no special anchors at all.\n");
  // Under homeDir's fixed ~/.claude/CLAUDE.md path — loaded regardless of
  // cwd, which the measured-reality tests below point at a synthetic
  // "P:\\scoped" path unrelated to TEMP_ROOT's own ancestor chain.
  writeFileSync(
    path.join(TEMP_ROOT, ".claude", "CLAUDE.md"),
    "# User fixture\n- Another rule with no special anchors at all, just prose.\n",
  );
});

afterAll(() => {
  rmSync(TEMP_ROOT, { recursive: true, force: true });
});

describe("buildDoctorReport — cost math", () => {
  it("computes per-turn / per-100-turn / per-month figures consistently for the chosen model", async () => {
    const report = await buildDoctorReport({
      cwd: TEMP_ROOT,
      modelAlias: "sonnet",
      turnsPerDay: 10,
      maxSessions: 1,
      all: false,
      includeTranscripts: false,
      includeAgents: false,
      failOverTokens: undefined,
      homeDir: TEMP_ROOT, // no .claude dir here -> user chain is just "missing"
    });

    expect(report.cost).toBeDefined();
    const c = report.cost!;
    expect(c.per100TurnsUncachedUsd).toBeCloseTo(c.perTurnUncachedUsd * 100, 6);
    expect(c.perMonthUncachedUsd).toBeCloseTo(c.perTurnUncachedUsd * 10 * 30, 6);
    expect(c.perTurnCacheReadUsd).toBeLessThan(c.perTurnUncachedUsd);
    expect(report.transcriptsSkipped).toBe(true);
    expect(report.measured).toBeUndefined();
  });

  it("reports an error instead of throwing for an unknown model alias", async () => {
    const report = await buildDoctorReport({
      cwd: TEMP_ROOT,
      modelAlias: "not-a-real-model",
      turnsPerDay: 10,
      maxSessions: 1,
      all: false,
      includeTranscripts: false,
      includeAgents: false,
      failOverTokens: undefined,
      homeDir: TEMP_ROOT,
    });
    expect(report.cost).toBeUndefined();
    expect(report.costError).toMatch(/unknown model/);
  });

  it("sets failOverExceeded when the tree total exceeds the budget", async () => {
    const report = await buildDoctorReport({
      cwd: TEMP_ROOT,
      modelAlias: "sonnet",
      turnsPerDay: 10,
      maxSessions: 1,
      all: false,
      includeTranscripts: false,
      includeAgents: false,
      failOverTokens: 1, // the fixture CLAUDE.md alone is well over 1 token
      homeDir: TEMP_ROOT,
    });
    expect(report.failOverExceeded).toBe(true);
  });
});

describe("buildDoctorReport — measured reality + instruction replay + unreferenced-rule gating", () => {
  it("gates unreferenced-rules behind a minimum session count and says so", async () => {
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

    // The scoped fixture project only has 2 sessions — well under the
    // spec's 20-session floor for the unreferenced-rules check.
    expect(report.unreferencedSkippedReason).toMatch(/not enough history \(2 sessions?\)/);
    expect(report.unreferencedRules).toEqual([]);
    expect(report.measured?.sessionsAvailable).toBe(2);
    expect(report.measured?.sessionsScanned).toBe(2);
    expect(report.measured?.subagentSessionsAvailable).toBe(1);
  });

  it("prices the re-sent instruction chain per-turn by that turn's own model, excluding unpriced models from the $ total", async () => {
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

    const r = report.instructionReplay!;
    expect(r).toBeDefined();
    // (a) assistant turns (3) x chain tokens, exactly.
    expect(r.instructionTokensResent).toBe(report.totalTokens * 3);
    // (b) real measured input-side context across those 3 turns.
    expect(r.totalInputContextTokens).toBeGreaterThan(0);
    // One of the three turns is on "claude-made-up-model" — never priced as sonnet.
    expect(r.unpricedTurns).toBe(1);
    expect(r.unpricedModels).toContain("claude-made-up-model");
    expect(r.pricedUsd).toBeGreaterThan(0);
  });
});
