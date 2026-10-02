import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildInstructionTree, flattenTree } from "../src/doctor/discovery.js";
import { slugify } from "../src/core/paths.js";
import { makeTempRoot } from "./helpers/temp-root.js";

const FIXTURES_HOME = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "home");

// `cwd` discovery walks every ancestor directory looking for CLAUDE.md /
// .claude/CLAUDE.md / CLAUDE.local.md, all the way to the filesystem root.
// Real dev machines can have a real CLAUDE.md anywhere under the user's
// home directory, so every synthetic `cwd` used below lives directly under
// the drive root instead, in a disposable directory removed in afterAll.
const TEMP_ROOT = makeTempRoot("test");

beforeAll(() => {
  mkdirSync(TEMP_ROOT, { recursive: true });
});

afterAll(() => {
  rmSync(TEMP_ROOT, { recursive: true, force: true });
});

describe("buildInstructionTree — user CLAUDE.md, @imports, cycles, code-fence skip", () => {
  it("resolves imports recursively, skips imports inside code fences/inline code, and detects cycles without hanging", async () => {
    const cwd = TEMP_ROOT; // no project-level CLAUDE.md here — isolates this test to the user chain
    const result = await buildInstructionTree({ cwd, homeDir: FIXTURES_HOME, includeAgents: false });

    const flat = flattenTree(result.roots);
    const byBasename = new Set(flat.map((n) => path.basename(n.filePath)));

    // Real imports resolved.
    expect(byBasename.has("common.md")).toBe(true);
    expect(byBasename.has("cycle-a.md")).toBe(true);
    expect(byBasename.has("cycle-b.md")).toBe(true);

    // Fenced/inline-code "imports" must never be treated as real imports.
    expect(byBasename.has("not-a-real-import.md")).toBe(false);
    expect(byBasename.has("also-not-real.md")).toBe(false);

    // Missing import is a visible tree row, not a silent skip.
    const missing = flat.find((n) => path.basename(n.filePath) === "missing-file.md");
    expect(missing).toBeDefined();
    expect(missing?.exists).toBe(false);
    expect(result.warnings.some((w) => w.includes("missing-file.md"))).toBe(true);

    // The rules directory is picked up recursively, including a subfolder.
    expect(byBasename.has("top-level.md")).toBe(true);
    expect(byBasename.has("nested.md")).toBe(true);

    // Cycle (common -> cycle-a -> cycle-b -> cycle-a) must not hang and
    // must leave a trace rather than disappearing silently.
    expect(result.warnings.some((w) => /cycle/i.test(w))).toBe(true);

    // Total token count is the sum of every real (existing) file's tokens.
    const existing = flat.filter((n) => n.exists);
    const expectedTotal = existing.reduce((sum, n) => sum + n.tokens, 0);
    expect(result.totalTokens).toBe(expectedTotal);
    expect(result.totalTokens).toBeGreaterThan(0);
  });
});

describe("buildInstructionTree — project chain is root-first", () => {
  const projectCwd = path.join(TEMP_ROOT, "proj");

  beforeAll(() => {
    mkdirSync(path.join(projectCwd, ".claude"), { recursive: true });
    writeFileSync(path.join(TEMP_ROOT, "CLAUDE.md"), "# Outer project rules\n- Outer rule about `outer-tool`.\n");
    writeFileSync(path.join(projectCwd, ".claude", "CLAUDE.md"), "# Inner project rules\n- Inner rule about `inner-tool`.\n");
    writeFileSync(path.join(projectCwd, "CLAUDE.local.md"), "# Local overrides\n- Local-only rule.\n");
  });

  it("lists the outer ancestor's CLAUDE.md before the cwd's own project files", async () => {
    // Point at an empty home dir so this test is isolated from the user chain.
    const emptyHome = path.join(TEMP_ROOT, "home-b");
    mkdirSync(emptyHome, { recursive: true });

    const result = await buildInstructionTree({ cwd: projectCwd, homeDir: emptyHome, includeAgents: false });
    const projectNodes = result.roots.filter((n) => n.kind === "project" || n.kind === "project-local");
    const basenames = projectNodes.map((n) => path.basename(path.dirname(n.filePath)) + "/" + path.basename(n.filePath));

    const outerIndex = projectNodes.findIndex((n) => path.dirname(n.filePath) === TEMP_ROOT);
    const innerIndex = projectNodes.findIndex((n) => path.dirname(n.filePath) === path.join(projectCwd, ".claude"));
    const localIndex = projectNodes.findIndex((n) => n.kind === "project-local");

    expect(outerIndex).toBeGreaterThanOrEqual(0);
    expect(innerIndex).toBeGreaterThan(outerIndex);
    expect(localIndex).toBeGreaterThan(outerIndex);
    expect(basenames.length).toBe(3);
  });
});

describe("buildInstructionTree — auto-memory MEMORY.md", () => {
  it("includes the MEMORY.md file for this cwd's computed project slug", async () => {
    const home = path.join(TEMP_ROOT, "home-c");
    const cwd = path.join(TEMP_ROOT, "memproj");
    const slug = slugify(cwd);
    const memDir = path.join(home, ".claude", "projects", slug, "memory");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(path.join(memDir, "MEMORY.md"), "# Synthetic memory\n- Remember to check `synthetic-anchor`.\n");

    const result = await buildInstructionTree({ cwd, homeDir: home, includeAgents: false });
    const memNode = result.roots.find((n) => n.kind === "memory");
    expect(memNode).toBeDefined();
    expect(memNode?.exists).toBe(true);
    expect(memNode?.tokens).toBeGreaterThan(0);
  });
});
