/**
 * Renders a DoctorReport as pretty terminal output, JSON, or markdown.
 * picocolors already honors NO_COLOR and non-TTY output on its own
 * (`isColorSupported`), so no extra detection is needed here.
 */
import pc from "picocolors";
import type { DoctorReport, RuleFinding } from "./report.js";
import type { TreeNode } from "./discovery.js";
import type { ConflictFinding } from "./conflicts.js";

// ---------------------------------------------------------------------------
// Shared: annotate tree nodes with subtree totals + % of grand total.
// ---------------------------------------------------------------------------

export interface AnnotatedNode extends Omit<TreeNode, "children"> {
  subtreeTokens: number;
  percentOfTotal: number;
  children: AnnotatedNode[];
}

function subtreeTotal(node: TreeNode): number {
  return node.tokens + node.children.reduce((sum, c) => sum + subtreeTotal(c), 0);
}

export function annotateTree(nodes: TreeNode[], grandTotal: number): AnnotatedNode[] {
  return nodes.map((n) => {
    const subtreeTokens = subtreeTotal(n);
    return {
      ...n,
      subtreeTokens,
      percentOfTotal: grandTotal > 0 ? (subtreeTokens / grandTotal) * 100 : 0,
      children: annotateTree(n.children, grandTotal),
    };
  });
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

export function renderJson(report: DoctorReport): string {
  const annotated = annotateTree(report.tree, report.totalTokens);
  const payload = {
    schemaVersion: 1,
    cwd: report.cwd,
    generatedAt: report.generatedAt,
    tree: annotated,
    totalTokensApprox: report.totalTokens,
    treeWarnings: report.treeWarnings,
    cost: report.cost,
    costError: report.costError,
    measuredReality: report.measured ?? null,
    transcriptsSkipped: report.transcriptsSkipped,
    unreferencedRules: report.unreferencedRules,
    unmeasurableRules: report.unmeasurableRules,
    conflicts: report.conflicts,
    failOverExceeded: report.failOverExceeded,
  };
  return JSON.stringify(payload, null, 2);
}

// ---------------------------------------------------------------------------
// Pretty terminal
// ---------------------------------------------------------------------------

function kindLabel(kind: TreeNode["kind"]): string {
  switch (kind) {
    case "user-main": return "user";
    case "user-import": return "import";
    case "user-rules": return "rules";
    case "project": return "project";
    case "project-local": return "local";
    case "memory": return "memory";
    case "agents": return "agents.md";
    case "gemini": return "gemini.md";
    default: return kind;
  }
}

function renderTreeLines(nodes: AnnotatedNode[], prefix: string, lines: string[]): void {
  nodes.forEach((node, idx) => {
    const isLast = idx === nodes.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = prefix + (isLast ? "    " : "│   ");

    const label = pc.dim(`[${kindLabel(node.kind)}]`);
    if (!node.exists) {
      lines.push(`${prefix}${connector}${pc.yellow(node.filePath)} ${label} ${pc.red(`MISSING (${node.error})`)}`);
      return;
    }
    const tokenInfo = pc.cyan(`≈${node.tokens.toLocaleString()} tok`);
    const pct = pc.dim(`${node.percentOfTotal.toFixed(1)}%`);
    lines.push(`${prefix}${connector}${node.filePath} ${label} ${tokenInfo} ${pct}`);
    renderTreeLines(node.children, childPrefix, lines);
  });
}

function formatUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function renderRuleFinding(f: RuleFinding, sessionsNote: string): string {
  const head = f.heading ? pc.dim(` (under "${f.heading}")`) : "";
  const truncated = f.text.length > 100 ? `${f.text.slice(0, 100)}…` : f.text;
  return `  ${pc.dim(`${f.file}:${f.line}`)}${head}\n    "${truncated}"\n    ${pc.dim(sessionsNote)}`;
}

function renderConflict(c: ConflictFinding): string {
  if (c.kind === "duplicate") {
    return (
      `  ${pc.yellow("near-duplicate")} (${(c.similarity * 100).toFixed(0)}% similar)\n` +
      `    ${pc.dim(`${c.a.file}:${c.a.line}`)} "${c.a.text.slice(0, 80)}"\n` +
      `    ${pc.dim(`${c.b.file}:${c.b.line}`)} "${c.b.text.slice(0, 80)}"`
    );
  }
  return (
    `  ${pc.red("polarity conflict")} on anchor \`${c.anchor}\`\n` +
    `    ${pc.dim(`${c.a.file}:${c.a.line}`)} [${c.a.polarity}] "${c.a.text.slice(0, 80)}"\n` +
    `    ${pc.dim(`${c.b.file}:${c.b.line}`)} [${c.b.polarity}] "${c.b.text.slice(0, 80)}"`
  );
}

export function renderPretty(report: DoctorReport): string {
  const annotated = annotateTree(report.tree, report.totalTokens);
  const out: string[] = [];

  out.push(pc.bold(`claudemd-doctor — ${report.cwd}`));
  out.push("");
  out.push(pc.bold("1. Instruction tree") + pc.dim(" (load order, ≈ tokens = offline estimate)"));
  const treeLines: string[] = [];
  renderTreeLines(annotated, "", treeLines);
  out.push(...treeLines);
  out.push(pc.bold(`Total: ≈${report.totalTokens.toLocaleString()} tokens`));
  if (report.treeWarnings.length > 0) {
    out.push("");
    out.push(pc.yellow(`${report.treeWarnings.length} warning(s):`));
    for (const w of report.treeWarnings) out.push(`  ${pc.yellow(w)}`);
  }

  out.push("");
  out.push(pc.bold("2. Cost") + pc.dim(` (offline estimate, pricing last verified ${report.cost?.pricingLastVerified ?? "n/a"})`));
  if (report.cost) {
    const c = report.cost;
    out.push(`  Model: ${c.model.id} (alias: ${c.model.alias})`);
    out.push(`  Per turn:       ${formatUsd(c.perTurnUncachedUsd)} uncached  /  ${formatUsd(c.perTurnCacheReadUsd)} cache-read`);
    out.push(`  Per 100 turns:  ${formatUsd(c.per100TurnsUncachedUsd)} uncached  /  ${formatUsd(c.per100TurnsCacheReadUsd)} cache-read`);
    out.push(`  Per month @ ${c.turnsPerDay} turns/day: ${formatUsd(c.perMonthUncachedUsd)} uncached  /  ${formatUsd(c.perMonthCacheReadUsd)} cache-read`);
  } else {
    out.push(`  ${pc.red(report.costError ?? "cost unavailable")}`);
  }

  out.push("");
  out.push(pc.bold("3. Measured reality") + pc.dim(" (from real transcripts)"));
  if (report.transcriptsSkipped) {
    out.push(`  ${pc.dim("skipped (--no-transcripts)")}`);
  } else if (report.measured) {
    const m = report.measured;
    const totalRealTokens = m.inputTokens + m.cacheCreationInputTokens + m.cacheReadInputTokens;
    out.push(`  Sessions matched: ${m.sessionsFound}  (of ${m.filesScanned} files scanned)`);
    out.push(`  Your instructions were sent ${m.assistantTurns} times ≈ ${totalRealTokens.toLocaleString()} input-side tokens`);
    out.push(`  Real usage — input: ${m.inputTokens.toLocaleString()}  cache-write: ${m.cacheCreationInputTokens.toLocaleString()}  cache-read: ${m.cacheReadInputTokens.toLocaleString()}  output: ${m.outputTokens.toLocaleString()}`);
    if (m.malformedLineCount > 0) {
      out.push(`  ${pc.yellow(`${m.malformedLineCount} malformed line(s) skipped while scanning`)}`);
    }
  }

  out.push("");
  out.push(pc.bold("4. Unreferenced rules") + pc.dim(" (never referenced in scanned transcripts — not a claim they're useless)"));
  if (report.transcriptsSkipped) {
    out.push(`  ${pc.dim("skipped (--no-transcripts)")}`);
  } else if (report.unreferencedRules.length === 0) {
    out.push(`  ${pc.green("none found")}`);
  } else {
    const n = report.measured?.sessionsFound ?? 0;
    for (const f of report.unreferencedRules) {
      out.push(renderRuleFinding(f, `never referenced in ${n} session(s)`));
    }
  }
  if (!report.transcriptsSkipped && report.unmeasurableRules.length > 0) {
    out.push(`  ${pc.dim(`${report.unmeasurableRules.length} rule(s) unmeasurable (no extractable anchors)`)}`);
  }

  out.push("");
  out.push(pc.bold("5. Conflicts & duplicates") + pc.dim(" (heuristic, offline)"));
  if (report.conflicts.length === 0) {
    out.push(`  ${pc.green("none found")}`);
  } else {
    for (const c of report.conflicts) out.push(renderConflict(c));
  }

  if (report.failOverExceeded) {
    out.push("");
    out.push(pc.red(`FAIL: total tokens (${report.totalTokens}) exceeded --fail-over budget`));
  }

  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

function renderTreeMarkdown(nodes: AnnotatedNode[], depth: number, lines: string[]): void {
  for (const node of nodes) {
    const indent = "  ".repeat(depth);
    if (!node.exists) {
      lines.push(`${indent}- \`${node.filePath}\` *(${kindLabel(node.kind)})* — **MISSING** (${node.error})`);
    } else {
      lines.push(
        `${indent}- \`${node.filePath}\` *(${kindLabel(node.kind)})* — ≈${node.tokens.toLocaleString()} tok (${node.percentOfTotal.toFixed(1)}%)`,
      );
    }
    renderTreeMarkdown(node.children, depth + 1, lines);
  }
}

export function renderMarkdown(report: DoctorReport): string {
  const annotated = annotateTree(report.tree, report.totalTokens);
  const out: string[] = [];

  out.push(`# claudemd-doctor report — \`${report.cwd}\``);
  out.push("");
  out.push(`_Generated ${report.generatedAt}. All token counts are ≈ offline estimates._`);
  out.push("");

  out.push("## 1. Instruction tree");
  const treeLines: string[] = [];
  renderTreeMarkdown(annotated, 0, treeLines);
  out.push(...treeLines);
  out.push("");
  out.push(`**Total: ≈${report.totalTokens.toLocaleString()} tokens**`);
  if (report.treeWarnings.length > 0) {
    out.push("");
    out.push("**Warnings:**");
    for (const w of report.treeWarnings) out.push(`- ${w}`);
  }

  out.push("");
  out.push("## 2. Cost");
  if (report.cost) {
    const c = report.cost;
    out.push(`Model: \`${c.model.id}\` (pricing last verified ${c.pricingLastVerified})`);
    out.push("");
    out.push("| | Uncached | Cache-read |");
    out.push("|---|---|---|");
    out.push(`| Per turn | ${formatUsd(c.perTurnUncachedUsd)} | ${formatUsd(c.perTurnCacheReadUsd)} |`);
    out.push(`| Per 100 turns | ${formatUsd(c.per100TurnsUncachedUsd)} | ${formatUsd(c.per100TurnsCacheReadUsd)} |`);
    out.push(`| Per month @ ${c.turnsPerDay}/day | ${formatUsd(c.perMonthUncachedUsd)} | ${formatUsd(c.perMonthCacheReadUsd)} |`);
  } else {
    out.push(`**Error:** ${report.costError}`);
  }

  out.push("");
  out.push("## 3. Measured reality");
  if (report.transcriptsSkipped) {
    out.push("_skipped (`--no-transcripts`)_");
  } else if (report.measured) {
    const m = report.measured;
    out.push(`- Sessions matched: ${m.sessionsFound} (of ${m.filesScanned} files scanned)`);
    out.push(`- Instructions sent ${m.assistantTurns} times`);
    out.push(`- Real tokens — input: ${m.inputTokens.toLocaleString()}, cache-write: ${m.cacheCreationInputTokens.toLocaleString()}, cache-read: ${m.cacheReadInputTokens.toLocaleString()}, output: ${m.outputTokens.toLocaleString()}`);
    if (m.malformedLineCount > 0) out.push(`- ${m.malformedLineCount} malformed line(s) skipped`);
  }

  out.push("");
  out.push("## 4. Unreferenced rules");
  if (report.transcriptsSkipped) {
    out.push("_skipped (`--no-transcripts`)_");
  } else if (report.unreferencedRules.length === 0) {
    out.push("None found.");
  } else {
    const n = report.measured?.sessionsFound ?? 0;
    for (const f of report.unreferencedRules) {
      out.push(`- \`${f.file}:${f.line}\` — "${f.text.slice(0, 100)}" — never referenced in ${n} session(s)`);
    }
  }

  out.push("");
  out.push("## 5. Conflicts & duplicates");
  if (report.conflicts.length === 0) {
    out.push("None found.");
  } else {
    for (const c of report.conflicts) {
      if (c.kind === "duplicate") {
        out.push(`- **Near-duplicate** (${(c.similarity * 100).toFixed(0)}%): \`${c.a.file}:${c.a.line}\` vs \`${c.b.file}:${c.b.line}\``);
      } else {
        out.push(`- **Polarity conflict** on \`${c.anchor}\`: \`${c.a.file}:${c.a.line}\` [${c.a.polarity}] vs \`${c.b.file}:${c.b.line}\` [${c.b.polarity}]`);
      }
    }
  }

  return out.join("\n");
}
