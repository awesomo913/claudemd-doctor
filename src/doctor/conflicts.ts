/**
 * Heuristic, fully-offline detection of near-duplicate rules and
 * "always do X" vs "never do X" polarity conflicts across the instruction
 * tree. Each finding cites both file:line locations so the user can decide
 * for themselves whether it's a real conflict.
 *
 * Tuned for PRECISION over recall: on two real instruction chains (see
 * README / commit notes for the manual audit), the first pass flagged
 * generic ALL_CAPS words ("AND", "ALL", "API", "HOT", "README") as
 * "polarity conflicts" and flagged template/path lines as "duplicates".
 * Both categories below exist specifically to kill those false positives.
 */
import { extractTechnicalAnchors, type Rule } from "./rules.js";

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

/**
 * Strip backticked/code spans and path- or filename-shaped tokens, then
 * count what's left that looks like ordinary prose (alphabetic words of
 * length >= 2). A markdown table row or a bulleted list of file paths has
 * almost no prose and should never be compared for "near-duplicate" text
 * similarity — two unrelated path lists can look 90% similar by raw token
 * overlap while sharing zero actual meaning.
 */
function proseWordCount(text: string): number {
  const noCode = text.replace(/`[^`]*`/g, " ");
  const words = noCode.split(/\s+/).filter(Boolean);
  let count = 0;
  for (const w of words) {
    const cleaned = w.replace(/[^\w.\-/\\]/g, "");
    if (cleaned.length < 2) continue;
    const looksLikePathOrCode = /[\\/]/.test(cleaned) || /\.\w{1,5}$/.test(cleaned) || /^[A-Z0-9_-]{2,}$/.test(cleaned);
    if (looksLikePathOrCode) continue;
    if (!/^[A-Za-z][A-Za-z'-]*$/.test(cleaned)) continue;
    count += 1;
  }
  return count;
}

const DUPLICATE_THRESHOLD = 0.85;
const MIN_PROSE_WORDS_FOR_DUPLICATE_CHECK = 8;

export function findDuplicates(rules: Rule[]): DuplicateFinding[] {
  const findings: DuplicateFinding[] = [];
  const tokenized = rules.map((r) => tokenize(r.text));
  const proseCounts = rules.map((r) => proseWordCount(r.text));

  for (let i = 0; i < rules.length; i += 1) {
    const ruleA = rules[i];
    const tokensA = tokenized[i];
    if (!ruleA || !tokensA || (proseCounts[i] ?? 0) < MIN_PROSE_WORDS_FOR_DUPLICATE_CHECK) continue;

    for (let j = i + 1; j < rules.length; j += 1) {
      const ruleB = rules[j];
      const tokensB = tokenized[j];
      if (!ruleB || !tokensB || (proseCounts[j] ?? 0) < MIN_PROSE_WORDS_FOR_DUPLICATE_CHECK) continue;
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

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const POSITIVE_RE = /\b(always|must|should|use|do)\b/i;
const NEGATIVE_RE = /\b(never|don'?t|do not|avoid|shouldn'?t|must not)\b/i;
/**
 * "❌ do X — do Y instead" is a common anti-pattern bullet convention
 * (confirmed on a real chain's exe-packaging rules): the leading ❌ marks
 * the WHOLE bullet negative about the anti-pattern it names, even though
 * the corrective clause after the em-dash often contains "always"/"must".
 * Without this, that convention produced a false-positive polarity
 * conflict against an unrelated, genuinely negative rule sharing the same
 * anchor. A leading ❌/✗ always wins over any word-level match.
 */
const HARD_NEGATIVE_MARKER_RE = /^\s*[❌✗]/;
/** How many characters before an anchor's occurrence count as "governing" it. */
const POLARITY_WINDOW_CHARS = 40;

function polarityOf(text: string): "positive" | "negative" | undefined {
  if (HARD_NEGATIVE_MARKER_RE.test(text)) return "negative";
  // Negation wins when both appear — "never use X, use Y instead" is a
  // negative rule about X even though the word "use" also shows up.
  if (NEGATIVE_RE.test(text)) return "negative";
  if (POSITIVE_RE.test(text)) return "positive";
  return undefined; // neither — not useful for polarity conflicts
}

/**
 * Polarity of a rule with respect to one specific anchor, looking only at
 * the words immediately governing that anchor's occurrence rather than the
 * whole rule. A long rule can mention "always" in one clause and a
 * completely unrelated anchor three clauses later — the whole-text scan
 * used in the first version of this tool paired those up incorrectly.
 */
function polarityNearAnchor(text: string, anchor: string): "positive" | "negative" | undefined {
  // The ❌/✗ bullet marker governs the entire rule, not just a local
  // window — check the full text first (a window starting near the
  // anchor can easily slice the leading marker off).
  if (HARD_NEGATIVE_MARKER_RE.test(text)) return "negative";

  const idx = text.toLowerCase().indexOf(anchor.toLowerCase());
  if (idx === -1) return polarityOf(text);
  const windowStart = Math.max(0, idx - POLARITY_WINDOW_CHARS);
  const window = text.slice(windowStart, idx + anchor.length);
  return polarityOf(window);
}

/**
 * Two rules conflict in polarity when they share a *technical* anchor
 * (backticked token, filename, or path — never a bare English word) but
 * one governs it positively ("always use X") and the other negatively
 * ("never use X"), judged from a short window around each occurrence.
 */
export function findPolarityConflicts(rules: Rule[]): PolarityFinding[] {
  const findings: PolarityFinding[] = [];
  const byAnchor = new Map<string, Array<{ rule: Rule; polarity: "positive" | "negative" }>>();

  for (const rule of rules) {
    for (const anchor of extractTechnicalAnchors(rule.text)) {
      const polarity = polarityNearAnchor(rule.text, anchor);
      if (!polarity) continue;
      const key = anchor.toLowerCase();
      const list = byAnchor.get(key) ?? [];
      list.push({ rule, polarity });
      byAnchor.set(key, list);
    }
  }

  for (const [anchor, anchorRules] of byAnchor) {
    for (let i = 0; i < anchorRules.length; i += 1) {
      const a = anchorRules[i];
      if (!a) continue;

      for (let j = i + 1; j < anchorRules.length; j += 1) {
        const b = anchorRules[j];
        if (!b) continue;
        if (a.rule.file === b.rule.file && a.rule.line === b.rule.line) continue;
        if (a.polarity === b.polarity) continue;

        findings.push({
          kind: "polarity",
          anchor,
          a: { file: a.rule.file, line: a.rule.line, text: a.rule.text, polarity: a.polarity },
          b: { file: b.rule.file, line: b.rule.line, text: b.rule.text, polarity: b.polarity },
        });
      }
    }
  }

  return findings;
}

export function findConflicts(rules: Rule[]): ConflictFinding[] {
  return [...findDuplicates(rules), ...findPolarityConflicts(rules)];
}
