import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDoctorReport } from "../src/doctor/report.js";
import { renderJson } from "../src/doctor/render.js";
import { makeTempRoot } from "./helpers/temp-root.js";

const TEMP_ROOT = makeTempRoot("jsonsize-test");
const SCOPED_FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "claude-projects-scoped",
);

beforeAll(() => {
  mkdirSync(path.join(TEMP_ROOT, ".claude"), { recursive: true });
  writeFileSync(path.join(TEMP_ROOT, ".claude", "CLAUDE.md"), "# Fixture\n- A rule with no special anchors at all.\n");
});

afterAll(() => {
  rmSync(TEMP_ROOT, { recursive: true, force: true });
});

describe("JSON size fix: turnDetails is --verbose-only, perModelUsage is always present", () => {
  it("omits measuredReality.turnDetails from default JSON but includes a per-model aggregate", async () => {
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

    expect(report.perModelUsage).toBeDefined();
    expect(report.perModelUsage!.length).toBeGreaterThan(0);

    const defaultJson = JSON.parse(renderJson(report));
    expect(defaultJson.schemaVersion).toBe(3);
    expect(defaultJson.measuredReality.turnDetails).toBeUndefined();
    expect(defaultJson.perModelUsage).toBeInstanceOf(Array);
    expect(defaultJson.perModelUsage.length).toBeGreaterThan(0);

    const verboseJson = JSON.parse(renderJson(report, { verbose: true }));
    expect(Array.isArray(verboseJson.measuredReality.turnDetails)).toBe(true);
    expect(verboseJson.measuredReality.turnDetails.length).toBe(report.measured!.turnDetails.length);
  });

  it("aggregates per-model usage correctly, keeping an unpriced/unknown model separate", async () => {
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

    const models = report.perModelUsage!.map((m) => m.model);
    expect(models).toContain("claude-sonnet-5");
    expect(models).toContain("claude-opus-5-5");
    expect(models).toContain("claude-made-up-model");

    const totalTurnsAcrossModels = report.perModelUsage!.reduce((sum, m) => sum + m.turns, 0);
    expect(totalTurnsAcrossModels).toBe(report.measured!.assistantTurns);
  });
});
