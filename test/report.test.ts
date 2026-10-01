import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildDoctorReport } from "../src/doctor/report.js";

// Isolated home/cwd under the drive root so this never touches the real
// ~/.claude/CLAUDE.md on the dev machine (see discovery.test.ts for why).
const TEMP_ROOT = path.join("C:\\", `cmddoctor-report-test-${process.pid}-${Date.now()}`);

beforeAll(() => {
  mkdirSync(TEMP_ROOT, { recursive: true });
  writeFileSync(path.join(TEMP_ROOT, "CLAUDE.md"), "# Fixture\n- A rule with no special anchors at all.\n");
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
