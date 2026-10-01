/**
 * Renders a DoctorReport as pretty terminal output, JSON, or markdown.
 * picocolors already honors NO_COLOR and non-TTY output on its own
 * (`isColorSupported`), so no extra detection is needed here.
 */
import pc from "picocolors";
import path from "node:path";
import type { DoctorReport, RuleFinding } from "./report.js";
import type { TreeNode } from "./discovery.js";
import type { ConflictFinding } from "./conflicts.js";

export interface RenderOptions {
  /** --all-rules: show every unreferenced rule in pretty mode instead of the top 10. */
  showAllRules?: boolean;
  /** --verbose: JSON mode only — include the full per-turn detail array (can be tens of thousands of entries). */
  verbose?: boolean;
}

const UNREFERENCED_PRETTY_LIMIT = 10;

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

/**
 * Money formatting (precision fix): amounts under $1 are shown to 3
 * significant figures (e.g. "$0.0258", never rounded down to "$0.03") so a
 * per-turn cost doesn't collapse to noise. Amounts >= $1 use plain 2
 * decimal places, which is already enough significant figures for that
 * range.
 */
export function formatUsd(n: number): string {
  if (n === 0) return "$0";
  if (Math.abs(n) < 1) {
    const precise = n.toPrecision(3);
    // toPrecision can return exponential notation for very small numbers
    // (e.g. "1.23e-6") — leave that as-is rather than mangling it further.
    return `$${precise}`;
  }
  return `$${n.toFixed(2)}`;
}

/**
 * Display-only path shortening: a path under the home dir renders as
 * "~/...", a path under cwd renders as "./...", anything else stays
 * absolute. Pretty/markdown only — JSON always keeps full absolute paths
 * (a script parsing JSON shouldn't have to guess what "~" resolves to).
 * Fixes both the GIF's line-wrapping (absolute paths on this dev machine
 * ran 60+ characters) and real usernames/paths leaking into a pasted
 * screenshot.
 */
function shortenPath(absolutePath: string, homeDir: string, cwd: string): string {
  const normalized = path.resolve(absolutePath);
  const normalizedHome = path.resolve(homeDir);
  const normalizedCwd = path.resolve(cwd);

  if (normalized === normalizedHome) return "~";
  if (normalized.startsWith(normalizedHome + path.sep)) {
    return `~/${normalized.slice(normalizedHome.length + 1).split(path.sep).join("/")}`;
  }
  if (normalized === normalizedCwd) return ".";
  if (normalized.startsWith(normalizedCwd + path.sep)) {
    return `./${normalized.slice(normalizedCwd.length + 1).split(path.sep).join("/")}`;
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/**
 * JSON size fix: `measuredReality.turnDetails` is one object per assistant
 * turn — 19,525 of them on a real chain — which makes default --json
 * output huge for no good reason, since `perModelUsage` (always present)
 * already answers "how much, on which model" for everyone who isn't
 * debugging turn-by-turn. The full array is kept, but only under
 * `--verbose`.
 */
export function renderJson(report: DoctorReport, options: RenderOptions = {}): string {
  const annotated = annotateTree(report.tree, report.totalTokens);
  const measuredReality = report.measured
    ? options.verbose
      ? report.measured
      : { ...report.measured, turnDetails: undefined }
    : null;
  const payload = {
    schemaVersion: 3,
    cwd: report.cwd,
    generatedAt: report.generatedAt,
    summary: report.summary,
    tree: annotated,
    totalTokensApprox: report.totalTokens,
    treeWarnings: report.treeWarnings,
    transcriptWarnings: report.transcriptWarnings,
    cost: report.cost,
    costError: report.costError,
    measuredReality,
    perModelUsage: report.perModelUsage ?? null,
    instructionReplay: report.instructionReplay ?? null,
    transcriptsSkipped: report.transcriptsSkipped,
    unreferencedRules: report.unreferencedRules,
    unreferencedHeadline: report.unreferencedHeadline ?? null,
    unreferencedSkippedReason: report.unreferencedSkippedReason ?? null,
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

function renderTreeLines(nodes: AnnotatedNode[], prefix: string, lines: string[], homeDir: string, cwd: string): void {
  nodes.forEach((node, idx) => {
    const isLast = idx === nodes.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = prefix + (isLast ? "    " : "│   ");
    const displayPath = shortenPath(node.filePath, homeDir, cwd);

    const label = pc.dim(`[${kindLabel(node.kind)}]`);
    if (!node.exists) {
      lines.push(`${prefix}${connector}${pc.yellow(displayPath)} ${label} ${pc.red(`MISSING (${node.error})`)}`);
      return;
    }
    const tokenInfo = pc.cyan(`≈${node.tokens.toLocaleString()} tok`);
    const pct = pc.dim(`${node.percentOfTotal.toFixed(1)}%`);
    lines.push(`${prefix}${connector}${displayPath} ${label} ${tokenInfo} ${pct}`);
    renderTreeLines(node.children, childPrefix, lines, homeDir, cwd);
  });
}

function renderRuleFinding(f: RuleFinding, sessionsNote: string, homeDir: string, cwd: string): string {
  const head = f.heading ? pc.dim(` (under "${f.heading}")`) : "";
  const truncated = f.text.length > 100 ? `${f.text.slice(0, 100)}…` : f.text;
  const displayPath = shortenPath(f.file, homeDir, cwd);
  return `  ${pc.dim(`${displayPath}:${f.line}`)} ${pc.cyan(`≈${f.tokenCost} tok`)}${head}\n    "${truncated}"\n    ${pc.dim(sessionsNote)}`;
}

function renderConflict(c: ConflictFinding, homeDir: string, cwd: string): string {
  const aPath = shortenPath(c.a.file, homeDir, cwd);
  const bPath = shortenPath(c.b.file, homeDir, cwd);
  if (c.kind === "duplicate") {
    return (
      `  ${pc.yellow("near-duplicate")} (${(c.similarity * 100).toFixed(0)}% similar)\n` +
      `    ${pc.dim(`${aPath}:${c.a.line}`)} "${c.a.text.slice(0, 80)}"\n` +
      `    ${pc.dim(`${bPath}:${c.b.line}`)} "${c.b.text.slice(0, 80)}"`
    );
  }
  return (
    `  ${pc.red("polarity conflict")} on anchor \`${c.anchor}\`\n` +
    `    ${pc.dim(`${aPath}:${c.a.line}`)} [${c.a.polarity}] "${c.a.text.slice(0, 80)}"\n` +
    `    ${pc.dim(`${bPath}:${c.b.line}`)} [${c.b.polarity}] "${c.b.text.slice(0, 80)}"`
  );
}

/**
 * The GIF's "money shot": a compact boxed one-glance summary before
 * section 1. Ragged-right box (no right border) so colored text doesn't
 * need visible-width math to stay aligned.
 */
function renderSummaryBoxPretty(report: DoctorReport): string[] {
  const s = report.summary;
  const out: string[] = [];
  out.push(pc.dim("┌─ summary ") + pc.dim("─".repeat(40)));

  const parts: string[] = [pc.bold(`≈${s.chainTokens.toLocaleString()} tokens`) + " re-sent every turn"];
  if (s.monthlyCachedUsd !== undefined && s.monthlyUncachedUsd !== undefined) {
    const label = s.monthlyCachedIsMeasured ? "cached" : "cached, est.";
    parts.push(`${pc.bold(formatUsd(s.monthlyCachedUsd))}/mo ${label} (${formatUsd(s.monthlyUncachedUsd)} uncached)`);
  }
  if (s.neverReferencedPercent !== undefined) {
    parts.push(pc.bold(`${s.neverReferencedPercent.toFixed(1)}%`) + " never referenced");
  }
  const conflictText = `${s.conflictsCount} conflict${s.conflictsCount === 1 ? "" : "s"}`;
  parts.push(s.conflictsCount > 0 ? pc.red(pc.bold(String(s.conflictsCount))) + ` conflict${s.conflictsCount === 1 ? "" : "s"}` : conflictText);

  out.push(`│  ${parts.join(pc.dim("  ·  "))}`);
  out.push(pc.dim("└" + "─".repeat(50)));
  return out;
}

function renderSummaryLineMarkdown(report: DoctorReport): string {
  const s = report.summary;
  const parts: string[] = [`**≈${s.chainTokens.toLocaleString()} tokens** re-sent every turn`];
  if (s.monthlyCachedUsd !== undefined && s.monthlyUncachedUsd !== undefined) {
    const label = s.monthlyCachedIsMeasured ? "cached" : "cached, est.";
    parts.push(`**${formatUsd(s.monthlyCachedUsd)}/mo** ${label} (${formatUsd(s.monthlyUncachedUsd)} uncached)`);
  }
  if (s.neverReferencedPercent !== undefined) {
    parts.push(`**${s.neverReferencedPercent.toFixed(1)}%** never referenced`);
  }
  parts.push(`**${s.conflictsCount}** conflict${s.conflictsCount === 1 ? "" : "s"}`);
  return `> ${parts.join(" · ")}`;
}

function renderMeasuredRealityLines(report: DoctorReport, out: string[]): void {
  if (report.transcriptsSkipped) {
    out.push(`  ${pc.dim("skipped (--no-transcripts)")}`);
    return;
  }
  const m = report.measured;
  if (!m) return;

  const successfullyScanned = m.sessionsScanned - m.sessionsUnreadable;
  out.push(
    `  Sessions: ${m.sessionsAvailable.toLocaleString()} exist, ${successfullyScanned.toLocaleString()} of ${m.sessionsScanned.toLocaleString()} scanned` +
      (m.sessionsUnreadable > 0 ? `, ${m.sessionsUnreadable.toLocaleString()} skipped (unreadable)` : "") +
      (m.subagentSessionsAvailable > 0 ? ` (+ ${m.subagentSessionsAvailable.toLocaleString()} subagent sessions, counted separately)` : ""),
  );
  out.push(`  Assistant turns in scanned sessions: ${m.assistantTurns.toLocaleString()}`);
  if (m.malformedLineCount > 0) {
    out.push(`  ${pc.yellow(`${m.malformedLineCount} malformed line(s) skipped while scanning`)}`);
  }
  if (report.transcriptWarnings.length > 0) {
    out.push(`  ${pc.yellow(`${report.transcriptWarnings.length} transcript-scan warning(s):`)}`);
    for (const w of report.transcriptWarnings) out.push(`    ${pc.yellow(w)}`);
  }

  const r = report.instructionReplay;
  if (!r) return;
  out.push("");
  out.push(`  (a) Instruction tokens re-sent ≈ ${m.assistantTurns} turns × ≈${report.totalTokens.toLocaleString()} chain tok ≈ ${r.instructionTokensResent.toLocaleString()} tok`);
  out.push(`  (b) Total measured input-side context across those turns: ${r.totalInputContextTokens.toLocaleString()} tok`);
  out.push(
    `  (c) Instructions are ≈${r.avgInstructionsPercentOfRequest !== undefined ? `${r.avgInstructionsPercentOfRequest.toFixed(1)}%` : "n/a"} of the average request`,
  );
  const pricedNote =
    r.unpricedTurns > 0
      ? pc.yellow(` (${r.unpricedTurns} turn(s) on unpriced model(s) [${r.unpricedModels.join(", ")}] excluded)`)
      : "";
  out.push(`  (d) $ for (a), priced per-turn by that turn's own model: ${formatUsd(r.pricedUsd)}${pricedNote}`);
}

export function renderPretty(report: DoctorReport, options: RenderOptions = {}): string {
  const annotated = annotateTree(report.tree, report.totalTokens);
  const { homeDir, cwd } = report;
  const out: string[] = [];

  out.push(pc.bold(`claudemd-doctor — ${report.cwd}`));
  out.push("");
  out.push(...renderSummaryBoxPretty(report));
  out.push("");
  out.push(pc.bold("1. Instruction tree") + pc.dim(" (load order, ≈ tokens = offline estimate)"));
  const treeLines: string[] = [];
  renderTreeLines(annotated, "", treeLines, homeDir, cwd);
  out.push(...treeLines);
  out.push(pc.bold(`Total: ≈${report.totalTokens.toLocaleString()} tokens`));
  if (report.treeWarnings.length > 0) {
    out.push("");
    out.push(pc.yellow(`${report.treeWarnings.length} warning(s):`));
    for (const w of report.treeWarnings) out.push(`  ${pc.yellow(w)}`);
  }

  out.push("");
  out.push(
    pc.bold("2. Cost") +
      pc.dim(` (offline estimate; pricing verified ${report.cost?.pricingVerifiedDate ?? "n/a"} @ ${report.cost?.pricingSourceUrl ?? "n/a"})`),
  );
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
  renderMeasuredRealityLines(report, out);

  out.push("");
  out.push(pc.bold("4. Unreferenced rules") + pc.dim(" (never referenced in scanned transcripts — not a claim they're useless)"));
  if (report.transcriptsSkipped) {
    out.push(`  ${pc.dim("skipped (--no-transcripts)")}`);
  } else if (report.unreferencedSkippedReason) {
    out.push(`  ${pc.dim(report.unreferencedSkippedReason)}`);
  } else if (report.unreferencedRules.length === 0) {
    out.push(`  ${pc.green("none found")}`);
  } else {
    const h = report.unreferencedHeadline;
    if (h) {
      out.push(
        pc.bold(`  ≈${h.totalTokens.toLocaleString()} tokens/turn (${h.percentOfChain.toFixed(1)}%) are rules never referenced in ${h.sessionsScanned} sessions`),
      );
      out.push("");
    }
    const n = report.measured?.sessionsScanned ?? 0;
    const shown = options.showAllRules ? report.unreferencedRules : report.unreferencedRules.slice(0, UNREFERENCED_PRETTY_LIMIT);
    for (const f of shown) {
      out.push(renderRuleFinding(f, `never referenced in ${n} session(s)`, homeDir, cwd));
    }
    const remaining = report.unreferencedRules.length - shown.length;
    if (remaining > 0) {
      out.push(`  ${pc.dim(`+${remaining} more (use --all-rules or --json)`)}`);
    }
  }
  if (!report.transcriptsSkipped && !report.unreferencedSkippedReason && report.unmeasurableRules.length > 0) {
    out.push(`  ${pc.dim(`${report.unmeasurableRules.length} rule(s) unmeasurable (no extractable anchors)`)}`);
  }

  out.push("");
  out.push(pc.bold("5. Conflicts & duplicates") + pc.dim(" (heuristic, offline)"));
  if (report.conflicts.length === 0) {
    out.push(`  ${pc.green("none found")}`);
  } else {
    for (const c of report.conflicts) out.push(renderConflict(c, homeDir, cwd));
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

function renderTreeMarkdown(nodes: AnnotatedNode[], depth: number, lines: string[], homeDir: string, cwd: string): void {
  for (const node of nodes) {
    const indent = "  ".repeat(depth);
    const displayPath = shortenPath(node.filePath, homeDir, cwd);
    if (!node.exists) {
      lines.push(`${indent}- \`${displayPath}\` *(${kindLabel(node.kind)})* — **MISSING** (${node.error})`);
    } else {
      lines.push(
        `${indent}- \`${displayPath}\` *(${kindLabel(node.kind)})* — ≈${node.tokens.toLocaleString()} tok (${node.percentOfTotal.toFixed(1)}%)`,
      );
    }
    renderTreeMarkdown(node.children, depth + 1, lines, homeDir, cwd);
  }
}

export function renderMarkdown(report: DoctorReport, options: RenderOptions = {}): string {
  const annotated = annotateTree(report.tree, report.totalTokens);
  const { homeDir, cwd } = report;
  const out: string[] = [];

  out.push(`# claudemd-doctor report — \`${report.cwd}\``);
  out.push("");
  out.push(`_Generated ${report.generatedAt}. All token counts are ≈ offline estimates._`);
  out.push("");
  out.push(renderSummaryLineMarkdown(report));
  out.push("");

  out.push("## 1. Instruction tree");
  const treeLines: string[] = [];
  renderTreeMarkdown(annotated, 0, treeLines, homeDir, cwd);
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
    out.push(`Model: \`${c.model.id}\` (pricing verified ${c.pricingVerifiedDate} at <${c.pricingSourceUrl}>)`);
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
    const successfullyScanned = m.sessionsScanned - m.sessionsUnreadable;
    out.push(
      `- Sessions: ${m.sessionsAvailable} exist, ${successfullyScanned} of ${m.sessionsScanned} scanned` +
        (m.sessionsUnreadable > 0 ? `, ${m.sessionsUnreadable} skipped (unreadable)` : "") +
        (m.subagentSessionsAvailable > 0 ? ` (+ ${m.subagentSessionsAvailable} subagent sessions, counted separately)` : ""),
    );
    out.push(`- Assistant turns in scanned sessions: ${m.assistantTurns}`);
    if (m.malformedLineCount > 0) out.push(`- ${m.malformedLineCount} malformed line(s) skipped`);
    if (report.transcriptWarnings.length > 0) {
      out.push("- **Transcript-scan warnings:**");
      for (const w of report.transcriptWarnings) out.push(`  - ${w}`);
    }
    const r = report.instructionReplay;
    if (r) {
      out.push(`- (a) Instruction tokens re-sent ≈ ${r.instructionTokensResent.toLocaleString()} tok`);
      out.push(`- (b) Total measured input-side context: ${r.totalInputContextTokens.toLocaleString()} tok`);
      out.push(`- (c) Instructions ≈${r.avgInstructionsPercentOfRequest !== undefined ? `${r.avgInstructionsPercentOfRequest.toFixed(1)}%` : "n/a"} of the average request`);
      out.push(
        `- (d) $ for (a), priced per-turn by model: ${formatUsd(r.pricedUsd)}${r.unpricedTurns > 0 ? ` (${r.unpricedTurns} turn(s) on unpriced model(s) [${r.unpricedModels.join(", ")}] excluded)` : ""}`,
      );
    }
  }

  out.push("");
  out.push("## 4. Unreferenced rules");
  if (report.transcriptsSkipped) {
    out.push("_skipped (`--no-transcripts`)_");
  } else if (report.unreferencedSkippedReason) {
    out.push(`_${report.unreferencedSkippedReason}_`);
  } else if (report.unreferencedRules.length === 0) {
    out.push("None found.");
  } else {
    const h = report.unreferencedHeadline;
    if (h) out.push(`**≈${h.totalTokens.toLocaleString()} tokens/turn (${h.percentOfChain.toFixed(1)}%) are rules never referenced in ${h.sessionsScanned} sessions**`);
    out.push("");
    const n = report.measured?.sessionsScanned ?? 0;
    const shown = options.showAllRules ? report.unreferencedRules : report.unreferencedRules.slice(0, UNREFERENCED_PRETTY_LIMIT);
    for (const f of shown) {
      out.push(`- \`${shortenPath(f.file, homeDir, cwd)}:${f.line}\` (≈${f.tokenCost} tok) — "${f.text.slice(0, 100)}" — never referenced in ${n} session(s)`);
    }
    const remaining = report.unreferencedRules.length - shown.length;
    if (remaining > 0) out.push(`- _+${remaining} more (use --all-rules or --json)_`);
  }

  out.push("");
  out.push("## 5. Conflicts & duplicates");
  if (report.conflicts.length === 0) {
    out.push("None found.");
  } else {
    for (const c of report.conflicts) {
      const aPath = shortenPath(c.a.file, homeDir, cwd);
      const bPath = shortenPath(c.b.file, homeDir, cwd);
      if (c.kind === "duplicate") {
        out.push(`- **Near-duplicate** (${(c.similarity * 100).toFixed(0)}%): \`${aPath}:${c.a.line}\` vs \`${bPath}:${c.b.line}\``);
      } else {
        out.push(`- **Polarity conflict** on \`${c.anchor}\`: \`${aPath}:${c.a.line}\` [${c.a.polarity}] vs \`${bPath}:${c.b.line}\` [${c.b.polarity}]`);
      }
    }
  }

  return out.join("\n");
}
