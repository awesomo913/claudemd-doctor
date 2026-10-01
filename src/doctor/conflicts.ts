/**
 * Heuristic, fully-offline detection of near-duplicate rules and
 * "always do X" vs "never do X" polarity conflicts across the instruction
 * tree. Each finding cites both file:line locations so the user can decide
 * for themselves whether it's a real conflict.
 */
import type { Rule } from "./rules.js";

export interface DuplicateFinding {
  kind: "duplicate";
  similarity: number;
  a: { file: string; line: number; text: string };
  b: { file: string; line: number; text: string };
}

export interface PolarityFinding {
  kind: "polarity";
  anchor: string;
  a: { file: string; line: number; text: string; polarity: "positive" | "negative" };
  b: { file: string; line: number; text: string; polarity: "positive" | "negative" };
}

export type ConflictFinding = DuplicateFinding | PolarityFinding;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is",
  "are", "be", "this", "that", "it", "as", "at", "by", "from",
]);

function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[`"*_]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
  return new Set(words);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const DUPLICATE_THRESHOLD = 0.85;
const MIN_WORDS_FOR_DUPLICATE_CHECK = 4;

export function findDuplicates(rules: Rule[]): DuplicateFinding[] {
  const findings: DuplicateFinding[] = [];
  const tokenized = rules.map((r) => tokenize(r.text));

  for (let i = 0; i < rules.length; i += 1) {
    const ruleA = rules[i];
    const tokensA = tokenized[i];
    if (!ruleA || !tokensA || tokensA.size < MIN_WORDS_FOR_DUPLICATE_CHECK) continue;

    for (let j = i + 1; j < rules.length; j += 1) {
      const ruleB = rules[j];
      const tokensB = tokenized[j];
      if (!ruleB || !tokensB || tokensB.size < MIN_WORDS_FOR_DUPLICATE_CHECK) continue;
      if (ruleA.file === ruleB.file && ruleA.line === ruleB.line) continue;

      const similarity = jaccard(tokensA, tokensB);
      if (similarity >= DUPLICATE_THRESHOLD) {
        findings.push({
          kind: "duplicate",
          similarity,
          a: { file: ruleA.file, line: ruleA.line, text: ruleA.text },
          b: { file: ruleB.file, line: ruleB.line, text: ruleB.text },
        });
      }
    }
  }

  return findings;
}

const POSITIVE_RE = /\b(always|must|should|use|do)\b/i;
const NEGATIVE_RE = /\b(never|don'?t|do not|avoid|shouldn'?t|must not)\b/i;

function polarityOf(text: string): "positive" | "negative" | undefined {
  // Negation wins when both appear — "never use X, use Y instead" is a
  // negative rule about X even though the word "use" also shows up.
  if (NEGATIVE_RE.test(text)) return "negative";
  if (POSITIVE_RE.test(text)) return "positive";
  return undefined; // neither — not useful for polarity conflicts
}

/**
 * Two rules conflict in polarity when they share an anchor (same command,
 * file, or distinctive phrase) but one asserts it positively ("always use
 * X") and the other negatively ("never use X").
 */
export function findPolarityConflicts(rules: Rule[]): PolarityFinding[] {
  const findings: PolarityFinding[] = [];
  const byAnchor = new Map<string, Rule[]>();

  for (const rule of rules) {
    for (const anchor of rule.anchors) {
      const key = anchor.toLowerCase();
      const list = byAnchor.get(key) ?? [];
      list.push(rule);
      byAnchor.set(key, list);
    }
  }

  for (const [anchor, anchorRules] of byAnchor) {
    for (let i = 0; i < anchorRules.length; i += 1) {
      const ruleA = anchorRules[i];
      if (!ruleA) continue;
      const polarityA = polarityOf(ruleA.text);
      if (!polarityA) continue;

      for (let j = i + 1; j < anchorRules.length; j += 1) {
        const ruleB = anchorRules[j];
        if (!ruleB) continue;
        if (ruleA.file === ruleB.file && ruleA.line === ruleB.line) continue;
        const polarityB = polarityOf(ruleB.text);
        if (!polarityB || polarityB === polarityA) continue;

        findings.push({
          kind: "polarity",
          anchor,
          a: { file: ruleA.file, line: ruleA.line, text: ruleA.text, polarity: polarityA },
          b: { file: ruleB.file, line: ruleB.line, text: ruleB.text, polarity: polarityB },
        });
      }
    }
  }

  return findings;
}

export function findConflicts(rules: Rule[]): ConflictFinding[] {
  return [...findDuplicates(rules), ...findPolarityConflicts(rules)];
}
