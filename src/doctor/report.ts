/**
 * Assembles the full doctor report: instruction tree + cost projection +
 * measured reality + unreferenced-rule check + conflict detection. Pure
 * data — rendering lives in render.ts.
 */
import { buildInstructionTree, flattenTree, type TreeNode } from "./discovery.js";
import { findAnchorsPresentInCorpus, splitIntoRules, type Rule } from "./rules.js";
import { findConflicts, type ConflictFinding } from "./conflicts.js";
import { scanForDoctor, type MeasuredReality, type TurnDetail } from "./analyze.js";
import { readFile } from "node:fs/promises";
import { countTokens } from "../core/tokens.js";
import {
  DEFAULT_MODEL_ALIAS,
  getPricing,
  PRICING_SOURCE_URL,
  PRICING_VERIFIED_DATE,
  type ModelPricing,
} from "../core/pricing.js";

export interface CostProjection {
  model: ModelPricing;
  turnsPerDay: number;
  totalTokens: number;
  perTurnUncachedUsd: number;
  perTurnCacheReadUsd: number;
  per100TurnsUncachedUsd: number;
  per100TurnsCacheReadUsd: number;
  perMonthUncachedUsd: number;
  perMonthCacheReadUsd: number;
  pricingSourceUrl: string;
  pricingVerifiedDate: string;
}

/**
 * The real, measured cost of re-sending the instruction chain every turn,
 * computed from actual transcripts rather than the flat "totalTokens x
 * price" estimate above. (a)-(d) match the four numbers the precision pass
 * asked for.
 */
export interface InstructionReplayCost {
  /** (a) assistant turns x chain tokens — the instructions re-sent, in tokens. */
  instructionTokensResent: number;
  /** (b) total measured input-side context (input + cache-write + cache-read) across scanned turns. */
  totalInputContextTokens: number;
  /** (c) chain tokens as a % of the average per-request context — undefined if there were 0 turns. */
  avgInstructionsPercentOfRequest: number | undefined;
  /** (d) $ for (a), priced per-turn using that turn's own model and cache-write/read split. */
  pricedUsd: number;
  /** Assistant turns whose recorded model has no pricing entry — never silently priced as another model. */
  unpricedTurns: number;
  unpricedModels: string[];
}

export interface RuleFinding {
  file: string;
  line: number;
  heading: string | undefined;
  text: string;
  anchors: string[];
  /** ≈tokens of this rule's own text — what the unreferenced-rules ranking sorts by. */
  tokenCost: number;
}

export interface UnreferencedHeadline {
  totalTokens: number;
  percentOfChain: number;
  sessionsScanned: number;
}

export interface DoctorReportOptions {
  cwd: string;
  modelAlias: string;
  turnsPerDay: number;
  maxSessions: number;
  all: boolean;
  includeTranscripts: boolean;
  includeAgents: boolean;
  failOverTokens: number | undefined;
  /** Override for testing — defaults to the real home directory. */
  homeDir?: string;
  /** Override for testing — defaults to the real ~/.claude/projects. */
  projectsDir?: string;
  /** How many session files to read concurrently (default 4). */
  concurrency?: number;
  /** Called after each session file finishes, with (filesDoneSoFar, totalFiles). */
  onProgress?: (done: number, total: number) => void;
}

export interface DoctorReport {
  cwd: string;
  generatedAt: string;
  tree: TreeNode[];
  totalTokens: number;
  treeWarnings: string[];
  cost: CostProjection | undefined;
  costError: string | undefined;
  measured: MeasuredReality | undefined;
  instructionReplay: InstructionReplayCost | undefined;
  unreferencedRules: RuleFinding[];
  unreferencedHeadline: UnreferencedHeadline | undefined;
  /** Set when the unreferenced-rules check was skipped for not having enough session history. */
  unreferencedSkippedReason: string | undefined;
  unmeasurableRules: RuleFinding[];
  conflicts: ConflictFinding[];
  failOverExceeded: boolean;
  transcriptsSkipped: boolean;
  /** Non-fatal problems while scanning transcripts (unreadable dirs, stat failures, ...). */
  transcriptWarnings: string[];
}

/** Below this many scanned sessions, "never referenced" is too noisy to report (spec: require >= 20). */
const MIN_SESSIONS_FOR_UNREFERENCED_CHECK = 20;

function computeCost(totalTokens: number, modelAlias: string, turnsPerDay: number): { cost?: CostProjection; error?: string } {
  const pricing = getPricing(modelAlias);
  if (!pricing) {
    return { error: `unknown model "${modelAlias}" — no pricing entry (see src/core/pricing.ts)` };
  }
  const perTurnUncachedUsd = (totalTokens / 1_000_000) * pricing.inputPerMTok;
  const perTurnCacheReadUsd = (totalTokens / 1_000_000) * pricing.cacheReadPerMTok;
  const DAYS_PER_MONTH = 30;
  return {
    cost: {
      model: pricing,
      turnsPerDay,
      totalTokens,
      perTurnUncachedUsd,
      perTurnCacheReadUsd,
      per100TurnsUncachedUsd: perTurnUncachedUsd * 100,
      per100TurnsCacheReadUsd: perTurnCacheReadUsd * 100,
      perMonthUncachedUsd: perTurnUncachedUsd * turnsPerDay * DAYS_PER_MONTH,
      perMonthCacheReadUsd: perTurnCacheReadUsd * turnsPerDay * DAYS_PER_MONTH,
      pricingSourceUrl: PRICING_SOURCE_URL,
      pricingVerifiedDate: PRICING_VERIFIED_DATE,
    },
  };
}

/**
 * Price one turn's share of the re-sent instruction chain using THAT turn's
 * own recorded model and its own fresh/cache-write-5m/cache-write-1h/
 * cache-read proportions. Returns undefined (never a silent sonnet-priced
 * guess) when the turn's model has no pricing entry.
 */
function priceTurnInstructionResend(turn: TurnDetail, chainTokens: number): number | undefined {
  const pricing = getPricing(turn.model ?? "");
  if (!pricing) return undefined;

  const turnTotal = turn.inputTokens + turn.cacheCreation5mInputTokens + turn.cacheCreation1hInputTokens + turn.cacheReadInputTokens;
  if (turnTotal <= 0) {
    // No usable split for this turn — fall back to pricing the whole resend
    // as fresh input at this turn's model, rather than dropping it silently.
    return (chainTokens / 1_000_000) * pricing.inputPerMTok;
  }

  const freshTokens = chainTokens * (turn.inputTokens / turnTotal);
  const write5mTokens = chainTokens * (turn.cacheCreation5mInputTokens / turnTotal);
  const write1hTokens = chainTokens * (turn.cacheCreation1hInputTokens / turnTotal);
  const readTokens = chainTokens * (turn.cacheReadInputTokens / turnTotal);

  return (
    (freshTokens / 1_000_000) * pricing.inputPerMTok +
    (write5mTokens / 1_000_000) * pricing.cacheWrite5mPerMTok +
    (write1hTokens / 1_000_000) * pricing.cacheWrite1hPerMTok +
    (readTokens / 1_000_000) * pricing.cacheReadPerMTok
  );
}

function computeInstructionReplay(chainTokens: number, measured: MeasuredReality): InstructionReplayCost {
  const totalInputContextTokens = measured.inputTokens + measured.cacheCreationInputTokens + measured.cacheReadInputTokens;
  const instructionTokensResent = chainTokens * measured.assistantTurns;
  const avgInstructionsPercentOfRequest =
    measured.assistantTurns > 0 && totalInputContextTokens > 0
      ? (chainTokens / (totalInputContextTokens / measured.assistantTurns)) * 100
      : undefined;

  let pricedUsd = 0;
  let unpricedTurns = 0;
  const unpricedModels = new Set<string>();

  for (const turn of measured.turnDetails) {
    const cost = priceTurnInstructionResend(turn, chainTokens);
    if (cost === undefined) {
      unpricedTurns += 1;
      unpricedModels.add(turn.model ?? "(unknown model)");
      continue;
    }
    pricedUsd += cost;
  }

  return {
    instructionTokensResent,
    totalInputContextTokens,
    avgInstructionsPercentOfRequest,
    pricedUsd,
    unpricedTurns,
    unpricedModels: [...unpricedModels],
  };
}

async function collectRules(nodes: TreeNode[], treeWarnings: string[]): Promise<Rule[]> {
  const flat = flattenTree(nodes);
  const rules: Rule[] = [];
  for (const node of flat) {
    if (!node.exists) continue;
    try {
      const content = await readFile(node.filePath, "utf8");
      rules.push(...splitIntoRules(content, node.filePath));
    } catch (err) {
      // Already reported as a tree warning when the node was built, but a
      // file can also fail to re-read here under a race (deleted between
      // the two reads) — report rather than swallow.
      treeWarnings.push(`${node.filePath}: failed re-reading for rule split: ${(err as Error).message}`);
    }
  }
  return rules;
}

export async function buildDoctorReport(options: DoctorReportOptions): Promise<DoctorReport> {
  const { roots, totalTokens, warnings } = await buildInstructionTree({
    cwd: options.cwd,
    includeAgents: options.includeAgents,
    homeDir: options.homeDir,
  });

  const { cost, error: costError } = computeCost(totalTokens, options.modelAlias, options.turnsPerDay);

  let measured: MeasuredReality | undefined;
  let instructionReplay: InstructionReplayCost | undefined;
  let unreferencedRules: RuleFinding[] = [];
  let unmeasurableRules: RuleFinding[] = [];
  let unreferencedHeadline: UnreferencedHeadline | undefined;
  let unreferencedSkippedReason: string | undefined;
  let transcriptWarnings: string[] = [];
  const rules = await collectRules(roots, warnings);
  const conflicts = findConflicts(rules);

  if (options.includeTranscripts) {
    const { reality, corpus } = await scanForDoctor({
      cwd: options.cwd,
      all: options.all,
      maxSessions: options.maxSessions,
      projectsDir: options.projectsDir,
      concurrency: options.concurrency,
      onProgress: options.onProgress,
    });
    measured = reality;
    transcriptWarnings = reality.warnings;
    instructionReplay = computeInstructionReplay(totalTokens, reality);

    if (reality.sessionsScanned < MIN_SESSIONS_FOR_UNREFERENCED_CHECK) {
      unreferencedSkippedReason = `not enough history (${reality.sessionsScanned} session${reality.sessionsScanned === 1 ? "" : "s"}) — skipped`;
    } else {
      // Speed fix: one combined pass over the corpus for every distinct
      // anchor across every rule, instead of one corpus scan per rule.
      const allAnchorsLower = rules.flatMap((r) => r.anchors.map((a) => a.toLowerCase()));
      const presentAnchors = findAnchorsPresentInCorpus(allAnchorsLower, corpus);

      const findings: RuleFinding[] = [];
      for (const rule of rules) {
        const finding: RuleFinding = {
          file: rule.file,
          line: rule.line,
          heading: rule.heading,
          text: rule.text,
          anchors: rule.anchors,
          tokenCost: countTokens(rule.text),
        };
        if (rule.anchors.length === 0) {
          unmeasurableRules.push(finding);
          continue;
        }
        const referenced = rule.anchors.some((a) => presentAnchors.has(a.toLowerCase()));
        if (!referenced) findings.push(finding);
      }
      findings.sort((a, b) => b.tokenCost - a.tokenCost);
      unreferencedRules = findings;

      const totalUnreferencedTokens = findings.reduce((sum, f) => sum + f.tokenCost, 0);
      unreferencedHeadline = {
        totalTokens: totalUnreferencedTokens,
        percentOfChain: totalTokens > 0 ? (totalUnreferencedTokens / totalTokens) * 100 : 0,
        sessionsScanned: reality.sessionsScanned,
      };
    }
  }

  const failOverExceeded = options.failOverTokens !== undefined && totalTokens > options.failOverTokens;

  return {
    cwd: options.cwd,
    generatedAt: new Date().toISOString(),
    tree: roots,
    totalTokens,
    treeWarnings: warnings,
    cost,
    costError,
    measured,
    instructionReplay,
    unreferencedRules,
    unreferencedHeadline,
    unreferencedSkippedReason,
    unmeasurableRules,
    conflicts,
    failOverExceeded,
    transcriptsSkipped: !options.includeTranscripts,
    transcriptWarnings,
  };
}

export { DEFAULT_MODEL_ALIAS };
