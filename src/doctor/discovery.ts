/**
 * Builds the "instruction tree" — every file Claude Code (and, with
 * --agents, Codex/Gemini) would auto-load for a given cwd, in load order,
 * with per-file token counts.
 */
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  ancestorDirsRootFirst,
  claudeRulesDir,
  expandTilde,
  memoryMdPath,
  userClaudeMdPath,
} from "../core/paths.js";
import { countTokens } from "../core/tokens.js";

export type NodeKind =
  | "user-main"
  | "user-import"
  | "user-rules"
  | "project"
  | "project-local"
  | "memory"
  | "agents"
  | "gemini";

export interface TreeNode {
  filePath: string;
  kind: NodeKind;
  exists: boolean;
  tokens: number;
  sizeBytes: number;
  /** Set when the file is missing or unreadable — never silently skipped. */
  error?: string;
  children: TreeNode[];
}

export interface DiscoveryResult {
  roots: TreeNode[];
  totalTokens: number;
  warnings: string[];
}

const MAX_IMPORT_DEPTH = 5;

async function readFileSafe(filePath: string): Promise<{ content: string | undefined; error: string | undefined }> {
  try {
    const content = await readFile(filePath, "utf8");
    return { content, error: undefined };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { content: undefined, error: "not found" };
    return { content: undefined, error: `unreadable: ${(err as Error).message}` };
  }
}

/**
 * Strip fenced code blocks and inline code spans so `@path` tokens that
 * appear only as documentation examples inside code aren't treated as real
 * imports. Replaced with equal-length whitespace to keep line numbers and
 * offsets stable for any future line-based reporting.
 */
function stripCode(content: string): string {
  let out = content.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, " "));
  out = out.replace(/`[^`\n]*`/g, (m) => m.replace(/[^\n]/g, " "));
  return out;
}

/**
 * Judgment call: an `@import` is only recognized when the `@` is at the
 * start of a line or preceded by whitespace, and the token after it looks
 * path-like (contains `.`, `/`, `\`, or starts with `~`). This matches the
 * real-world pattern observed on the dev machine (`@RTK.md` on its own
 * line) while avoiding false positives on `@mentions` in prose.
 */
const IMPORT_RE = /(^|\s)@([^\s`]+)/g;

export function parseImports(content: string, importingFileDir: string): string[] {
  const codeless = stripCode(content);
  const resolved: string[] = [];
  for (const m of codeless.matchAll(IMPORT_RE)) {
    const token = m[2];
    if (!token) continue;
    const looksPathLike = token.includes(".") || token.includes("/") || token.includes("\\") || token.startsWith("~");
    if (!looksPathLike) continue;
    const expanded = expandTilde(token);
    const abs = path.isAbsolute(expanded) ? expanded : path.resolve(importingFileDir, expanded);
    resolved.push(abs);
  }
  return [...new Set(resolved)];
}

async function buildFileNode(
  filePath: string,
  kind: NodeKind,
  visited: Set<string>,
  depth: number,
  warnings: string[],
): Promise<TreeNode> {
  const normalized = path.resolve(filePath);
  const { content, error } = await readFileSafe(normalized);

  if (error) {
    // Spec: missing/unreadable files are always surfaced as a warning row,
    // never silently skipped — even the top-level user CLAUDE.md, which is
    // optional but still worth calling out.
    warnings.push(`${normalized}: ${error}`);
    return { filePath: normalized, kind, exists: false, tokens: 0, sizeBytes: 0, error, children: [] };
  }

  const sizeBytes = Buffer.byteLength(content ?? "", "utf8");
  const tokens = countTokens(content ?? "");
  const node: TreeNode = { filePath: normalized, kind, exists: true, tokens, sizeBytes, children: [] };

  if (depth >= MAX_IMPORT_DEPTH) {
    warnings.push(`${normalized}: max import depth (${MAX_IMPORT_DEPTH}) reached, further @imports ignored`);
    return node;
  }

  if (visited.has(normalized)) {
    return node; // cycle guard — already expanded elsewhere in this chain
  }
  visited.add(normalized);

  const importPaths = parseImports(content ?? "", path.dirname(normalized));
  for (const importPath of importPaths) {
    if (visited.has(importPath)) {
      warnings.push(`${normalized}: @import cycle detected at ${importPath}, not re-expanded`);
      continue;
    }
    const childNode = await buildFileNode(importPath, "user-import", visited, depth + 1, warnings);
    node.children.push(childNode);
  }

  return node;
}

async function globMarkdownRecursive(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    const entries = await readdir(d, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push(full);
      }
    }
  }
  await walk(dir);
  return out.sort();
}

export interface DiscoveryOptions {
  cwd: string;
  includeAgents: boolean;
  /** Override for testing — defaults to the real home directory. */
  homeDir?: string;
}

function sumTokens(nodes: TreeNode[]): number {
  let total = 0;
  for (const n of nodes) {
    total += n.tokens + sumTokens(n.children);
  }
  return total;
}

export async function buildInstructionTree(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const warnings: string[] = [];
  const roots: TreeNode[] = [];

  // Judgment call / real-world edge case: when `.claude` is literally a
  // path segment in the ancestor chain (e.g. cwd is the home directory
  // itself, or is nested under ~/.claude), the project chain's own
  // "<dir>/.claude/CLAUDE.md" candidate can resolve to the exact same file
  // as the user's main `~/.claude/CLAUDE.md` — or two project candidates
  // from different ancestor dirs can collide with each other. Track every
  // absolute path already counted as a root (plus its expanded @imports) so
  // the same file is never read, token-counted, or rule-split twice.
  const rootPathsSeen = new Set<string>();

  async function addRoot(candidatePath: string, kind: NodeKind): Promise<void> {
    const normalized = path.resolve(candidatePath);
    if (rootPathsSeen.has(normalized)) {
      warnings.push(`${normalized}: already counted earlier in the instruction chain — not loaded twice`);
      return;
    }
    const node = await buildFileNode(candidatePath, kind, new Set(), 0, warnings);
    roots.push(node);
    for (const n of flattenTree([node])) rootPathsSeen.add(path.resolve(n.filePath));
  }

  // 1. User's main CLAUDE.md + recursive @imports.
  await addRoot(userClaudeMdPath(options.homeDir), "user-main");

  // 2. ~/.claude/rules/**/*.md
  const ruleFiles = await globMarkdownRecursive(claudeRulesDir(options.homeDir));
  for (const f of ruleFiles) {
    await addRoot(f, "user-rules");
  }

  // 3. Project CLAUDE.md / .claude/CLAUDE.md / CLAUDE.local.md, root-first.
  const dirs = ancestorDirsRootFirst(options.cwd);
  for (const dir of dirs) {
    const candidates: Array<{ p: string; kind: NodeKind }> = [
      { p: path.join(dir, "CLAUDE.md"), kind: "project" },
      { p: path.join(dir, ".claude", "CLAUDE.md"), kind: "project" },
      { p: path.join(dir, "CLAUDE.local.md"), kind: "project-local" },
    ];
    for (const { p, kind } of candidates) {
      if (!existsSync(p)) continue;
      await addRoot(p, kind);
    }
  }

  // 4. Auto-memory MEMORY.md for this cwd's project slug.
  const memPath = memoryMdPath(options.cwd, options.homeDir);
  if (existsSync(memPath)) {
    await addRoot(memPath, "memory");
  }

  // 5. --agents: AGENTS.md (Codex) and GEMINI.md (Gemini CLI) along the
  // same project directory chain, for comparison only.
  if (options.includeAgents) {
    for (const dir of dirs) {
      const agentsPath = path.join(dir, "AGENTS.md");
      if (existsSync(agentsPath)) {
        await addRoot(agentsPath, "agents");
      }
      const geminiPath = path.join(dir, "GEMINI.md");
      if (existsSync(geminiPath)) {
        await addRoot(geminiPath, "gemini");
      }
    }
  }

  return { roots, totalTokens: sumTokens(roots), warnings };
}

/** Flatten a tree into a list, depth-first, for rule-splitting / reporting. */
export function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  for (const n of nodes) {
    out.push(n);
    out.push(...flattenTree(n.children));
  }
  return out;
}
