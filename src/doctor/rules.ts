/**
 * Splits a markdown instruction file into individual "rules" (bullet items
 * or paragraphs under a heading) and extracts distinctive anchors from each
 * rule's text so the doctor can check whether a rule ever shows up in real
 * transcripts.
 */

export interface Rule {
  file: string;
  /** 1-indexed line the rule starts on. */
  line: number;
  heading: string | undefined;
  text: string;
  anchors: string[];
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

/**
 * Split `content` into rules. A rule is either a bullet/numbered list item
 * (continuation lines that are indented, or that don't start a new bullet
 * or heading, are folded in) or a standalone non-blank paragraph under a
 * heading. Blank lines and heading lines themselves are not rules.
 */
export function splitIntoRules(content: string, file: string): Rule[] {
  const lines = content.split(/\r?\n/);
  const rules: Rule[] = [];
  let heading: string | undefined;

  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i] ?? "";
    const line = rawLine;

    if (line.trim().length === 0) {
      i += 1;
      continue;
    }

    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      heading = headingMatch[2]?.trim();
      i += 1;
      continue;
    }

    const bulletMatch = BULLET_RE.exec(line);
    const startLine = i + 1; // 1-indexed
    const textParts: string[] = [];

    if (bulletMatch) {
      textParts.push(bulletMatch[3] ?? "");
      i += 1;
      // Fold in indented continuation lines belonging to the same bullet.
      while (i < lines.length) {
        const next = lines[i] ?? "";
        if (next.trim().length === 0) break;
        if (HEADING_RE.test(next) || BULLET_RE.test(next)) break;
        textParts.push(next.trim());
        i += 1;
      }
    } else {
      // Plain paragraph: fold in following non-blank, non-heading,
      // non-bullet lines.
      textParts.push(line.trim());
      i += 1;
      while (i < lines.length) {
        const next = lines[i] ?? "";
        if (next.trim().length === 0) break;
        if (HEADING_RE.test(next) || BULLET_RE.test(next)) break;
        textParts.push(next.trim());
        i += 1;
      }
    }

    const text = textParts.join(" ").trim();
    if (text.length === 0) continue;
    rules.push({ file, line: startLine, heading, text, anchors: extractAnchors(text) });
  }

  return rules;
}

const BACKTICK_RE = /`([^`]+)`/g;
const QUOTED_RE = /"([^"]{2,80})"/g;
const ALL_CAPS_RE = /\b[A-Z][A-Z0-9_]{2,}\b/g;
const FILENAME_RE = /\b[\w.-]+\.(?:md|ts|tsx|js|jsx|json|py|sh|ps1|yml|yaml|toml)\b/g;
const PATHISH_RE = /\b(?:~[\\/])?[\w.-]+(?:[\\/][\w.-]+)+\b/g;

/**
 * Words that are too generic to ever be a trustworthy anchor — mostly
 * ALL_CAPS structural markers (section labels like "HOT"/"WARM", common
 * connectives like "AND"/"ALL") that real instruction files are full of.
 * Filtered out everywhere anchors are used, so they never drive a false
 * "referenced" match or a false conflict.
 */
const GENERIC_ANCHOR_BLOCKLIST = new Set([
  "and", "all", "or", "any", "api", "hot", "warm", "cold", "readme", "next",
  "must", "should", "shouldn't", "never", "always", "not", "no", "yes", "ok",
  "ai", "cli", "gui", "http", "https", "url", "uri", "json", "yaml", "toml",
  "todo", "fixme", "new", "get", "set", "use", "do", "don't", "stop", "go",
  "the", "this", "that", "for", "with", "per", "via", "if", "else", "when",
  "situational",
]);

function isGeneric(anchor: string): boolean {
  return GENERIC_ANCHOR_BLOCKLIST.has(anchor.toLowerCase().trim());
}

/**
 * Pull distinctive anchors out of a rule's text: backticked tokens, quoted
 * phrases, ALL_CAPS words, filenames, and path-like tokens. These are the
 * strings we later look for in real transcript text to decide whether a
 * rule was ever acted on.
 */
export function extractAnchors(text: string): string[] {
  const anchors = new Set<string>();

  for (const m of text.matchAll(BACKTICK_RE)) {
    const v = m[1]?.trim();
    if (v) anchors.add(v);
  }
  for (const m of text.matchAll(QUOTED_RE)) {
    const v = m[1]?.trim();
    if (v) anchors.add(v);
  }
  for (const m of text.matchAll(ALL_CAPS_RE)) {
    anchors.add(m[0]);
  }
  for (const m of text.matchAll(FILENAME_RE)) {
    anchors.add(m[0]);
  }
  for (const m of text.matchAll(PATHISH_RE)) {
    anchors.add(m[0]);
  }

  // Drop anchors too short/common to be distinctive (would false-positive
  // against nearly any transcript).
  return [...anchors].filter((a) => a.replace(/[^\w]/g, "").length >= 3 && !isGeneric(a));
}

/**
 * Stricter anchor set used ONLY for conflict detection (duplicates and
 * polarity). Real-world tuning: plain ALL_CAPS words and quoted prose
 * phrases produced almost all the false-positive conflicts seen on real
 * instruction chains ("AND", "ALL", "API", "HOT", "README" flagged as
 * polarity anchors). Conflicts should only ever be raised on something
 * genuinely technical: a backticked token, a filename, or a path — never a
 * bare English word, even if it happens to be capitalized.
 */
export function extractTechnicalAnchors(text: string): string[] {
  const anchors = new Set<string>();
  for (const m of text.matchAll(BACKTICK_RE)) {
    const v = m[1]?.trim();
    if (v) anchors.add(v);
  }
  for (const m of text.matchAll(FILENAME_RE)) anchors.add(m[0]);
  for (const m of text.matchAll(PATHISH_RE)) anchors.add(m[0]);

  return [...anchors].filter((a) => {
    const stripped = a.replace(/[^\w]/g, "");
    if (stripped.length < 3) return false;
    // A multi-word backticked phrase ("npm test") is fine as long as no
    // individual word in it is generic; a single generic word is not.
    const words = a.toLowerCase().split(/\s+/);
    if (words.length === 1) return !isGeneric(a);
    return !words.some((w) => isGeneric(w));
  });
}

export interface ReferenceCheckResult {
  anchor: string;
  referenced: boolean;
}

/**
 * Check each anchor against a corpus of transcript text (assistant replies
 * + tool_use inputs). Matching is a simple case-insensitive substring
 * search — fast, offline, and conservative (false negatives are more
 * acceptable here than false positives on short/common strings, which
 * `extractAnchors` already filters for length).
 */
export function checkReferences(anchors: string[], corpus: string): ReferenceCheckResult[] {
  const haystack = corpus.toLowerCase();
  return anchors.map((anchor) => ({
    anchor,
    referenced: haystack.includes(anchor.toLowerCase()),
  }));
}
