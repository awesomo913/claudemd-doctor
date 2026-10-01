/**
 * Path + home-directory resolution helpers. No CLI imports — reusable by any tool.
 *
 * Judgment call (documented per task spec): the project-slug rule was verified
 * against real directories under `~/.claude/projects` on the dev machine. The
 * observed mapping is a per-character replace of `:`, `\\` and `/` with `-`
 * (no collapsing of consecutive dashes) applied to the raw `cwd` string Claude
 * Code recorded for a session — e.g. `C:\\` -> `C--`, `C:\\StolenEmerald` ->
 * `C--StolenEmerald`. That is what `slugify()` implements below.
 */
import { homedir } from "node:os";
import path from "node:path";

export function getHomeDir(): string {
  return homedir();
}

/** Expand a leading `~` (or `~/`, `~\\`) to the user's home directory. */
export function expandTilde(p: string): string {
  if (p === "~") return getHomeDir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(getHomeDir(), p.slice(2));
  }
  return p;
}

/**
 * Convert a `cwd` string into the project-directory slug Claude Code uses
 * under `~/.claude/projects/<slug>/`. Per-character replace of path
 * separators and the drive-letter colon with `-`; no merging of runs.
 */
export function slugify(cwd: string): string {
  let out = "";
  for (const ch of cwd) {
    out += ch === ":" || ch === "\\" || ch === "/" ? "-" : ch;
  }
  return out;
}

// Every helper below takes an optional `homeDir` override (defaulting to the
// real home directory) so tests can point the doctor at a synthetic fixture
// tree instead of the real `~/.claude`.

export function claudeHomeDir(homeDir: string = getHomeDir()): string {
  return path.join(homeDir, ".claude");
}

export function claudeProjectsDir(homeDir: string = getHomeDir()): string {
  return path.join(claudeHomeDir(homeDir), "projects");
}

export function claudeRulesDir(homeDir: string = getHomeDir()): string {
  return path.join(claudeHomeDir(homeDir), "rules");
}

export function userClaudeMdPath(homeDir: string = getHomeDir()): string {
  return path.join(claudeHomeDir(homeDir), "CLAUDE.md");
}

export function codexSessionsDir(homeDir: string = getHomeDir()): string {
  return path.join(homeDir, ".codex", "sessions");
}

export function geminiHomeDir(homeDir: string = getHomeDir()): string {
  return path.join(homeDir, ".gemini");
}

/** Path to the auto-memory MEMORY.md file for a given cwd's project slug. */
export function memoryMdPath(cwd: string, homeDir: string = getHomeDir()): string {
  return path.join(claudeProjectsDir(homeDir), slugify(cwd), "memory", "MEMORY.md");
}

/**
 * Walk `startDir` up to (and including) the filesystem root, returning
 * directories from the root down to `startDir` (outermost-first), which is
 * the order the doctor's tree renders project-level files in.
 */
export function ancestorDirsRootFirst(startDir: string): string[] {
  const dirs: string[] = [];
  let cur = path.resolve(startDir);
  while (true) {
    dirs.push(cur);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return dirs.reverse();
}
