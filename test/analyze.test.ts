import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverSlugSessionFiles,
  discoverSlugSubagentFiles,
  listProjectSlugs,
} from "../src/core/transcripts.js";
import { scanForDoctor } from "../src/doctor/analyze.js";

const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "claude-projects-scoped",
);

describe("scoped-by-slug session discovery (precision fix)", () => {
  it("finds only the target project's own session files, not other projects'", async () => {
    const files = await discoverSlugSessionFiles("P--scoped", FIXTURES_DIR);
    expect(files).toHaveLength(2);
    expect(files.every((f) => path.basename(path.dirname(f)) === "P--scoped")).toBe(true);
  });

  it("does not pull in a different project's sessions when scoped", async () => {
    const files = await discoverSlugSessionFiles("P--scoped", FIXTURES_DIR);
    expect(files.some((f) => f.includes("session-x"))).toBe(false);
  });

  it("counts subagent session files separately from main sessions", async () => {
    const main = await discoverSlugSessionFiles("P--scoped", FIXTURES_DIR);
    const subagents = await discoverSlugSubagentFiles("P--scoped", FIXTURES_DIR);
    expect(main).toHaveLength(2);
    expect(subagents).toHaveLength(1);
    expect(subagents[0]).toContain("agent-1");
  });

  it("returns an empty list for a slug with no project directory", async () => {
    const files = await discoverSlugSessionFiles("P--does-not-exist", FIXTURES_DIR);
    expect(files).toEqual([]);
  });

  it("lists every project slug for --all mode's subagent total", async () => {
    const slugs = await listProjectSlugs(FIXTURES_DIR);
    expect(slugs.sort()).toEqual(["P--other", "P--scoped"]);
  });
});

describe("scanForDoctor", () => {
  it("scopes to the target project's own sessions by default, reporting available vs scanned and subagent count", async () => {
    const { reality, corpus } = await scanForDoctor({
      cwd: "P:\\scoped",
      all: false,
      maxSessions: 200,
      projectsDir: FIXTURES_DIR,
    });
    expect(reality.sessionsAvailable).toBe(2);
    expect(reality.sessionsScanned).toBe(2);
    expect(reality.subagentSessionsAvailable).toBe(1);
    expect(reality.assistantTurns).toBe(3); // session-a: 1, session-b: 2
    expect(corpus).toContain("synthetic assistant reply a");
    expect(corpus).not.toContain("must not leak into scoped mode");
  });

  it("respects --max-sessions by taking the newest files first", async () => {
    const { reality } = await scanForDoctor({
      cwd: "P:\\scoped",
      all: false,
      maxSessions: 1,
      projectsDir: FIXTURES_DIR,
    });
    expect(reality.sessionsAvailable).toBe(2);
    expect(reality.sessionsScanned).toBe(1);
  });

  it("retains per-turn model + cache-TTL-split detail for cost math", async () => {
    const { reality } = await scanForDoctor({
      cwd: "P:\\scoped",
      all: false,
      maxSessions: 200,
      projectsDir: FIXTURES_DIR,
    });
    const sonnetTurn = reality.turnDetails.find((t) => t.model === "claude-sonnet-5" && t.inputTokens === 50);
    expect(sonnetTurn).toBeDefined();
    expect(sonnetTurn?.cacheCreation5mInputTokens).toBe(300);
    expect(sonnetTurn?.cacheCreation1hInputTokens).toBe(0);
    const unpricedTurn = reality.turnDetails.find((t) => t.model === "claude-made-up-model");
    expect(unpricedTurn).toBeDefined();
  });

  it("--all mode aggregates across every project, including the other project's sessions", async () => {
    const { reality, corpus } = await scanForDoctor({
      cwd: "P:\\scoped",
      all: true,
      maxSessions: 200,
      projectsDir: FIXTURES_DIR,
    });
    expect(reality.sessionsAvailable).toBe(3); // 2 in P--scoped + 1 in P--other
    expect(corpus).toContain("must not leak into scoped mode");
  });
});
