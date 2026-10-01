/**
 * Assembles the full doctor report: instruction tree + cost projection +
 * measured reality + unreferenced-rule check + conflict detection. Pure
 * data — rendering lives in render.ts.
 */
import { buildInstructionTree, flattenTree, type TreeNode } from "./discovery.js";
import { splitIntoRules, type Rule } from "./rules.js";
import { findConflicts, type ConflictFinding } from "./conflicts.js";
import { scanForDoctor, checkRuleAgainstCorpus, type MeasuredReality } from "./analyze.js";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_MODEL_ALIAS,
  getPricing,
  PRICING_LAST_VERIFIED,
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
  pricingLastVerified: string;
}

export interface RuleFinding {
  file: string;
  line: number;
  heading: string | undefined;
  text: string;
  anchors: string[];
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
  unreferencedRules: RuleFinding[];
  unmeasurableRules: RuleFinding[];
  conflicts: ConflictFinding[];
  failOverExceeded: boolean;
  transcriptsSkipped: boolean;
}

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
      pricingLastVerified: PRICING_LAST_VERIFIED,
    },
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
  let unreferencedRules: RuleFinding[] = [];
  let unmeasurableRules: RuleFinding[] = [];
  const rules = await collectRules(roots, warnings);
  const conflicts = findConflicts(rules);

  if (options.includeTranscripts) {
    const { reality, corpus } = await scanForDoctor({
      cwd: options.cwd,
      all: options.all,
      maxSessions: options.maxSessions,
    });
    measured = reality;

    for (const rule of rules) {
      const status = checkRuleAgainstCorpus(rule.anchors, corpus);
      const finding: RuleFinding = {
        file: rule.file,
        line: rule.line,
        heading: rule.heading,
        text: rule.text,
        anchors: rule.anchors,
      };
      if (status.unmeasurable) unmeasurableRules.push(finding);
      else if (!status.referenced) unreferencedRules.push(finding);
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
    unreferencedRules,
    unmeasurableRules,
    conflicts,
    failOverExceeded,
    transcriptsSkipped: !options.includeTranscripts,
  };
}

export { DEFAULT_MODEL_ALIAS };
