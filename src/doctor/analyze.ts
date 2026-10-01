/**
 * Scans real Claude Code transcripts once and derives both the "measured
 * reality" cost numbers and the corpus used to check whether instruction
 * rules are ever referenced.
 *
 * Session discovery (precision fix): the default (non---all) mode goes
 * straight to `~/.claude/projects/<slug>/` for this cwd instead of scanning
 * the newest N files machine-wide and filtering by cwd — on a machine with
 * thousands of sessions across many projects, that global scan starved
 * small/quiet projects down to a handful of matches. `--all` keeps the old
 * cross-project behavior (every project, newest-first, capped at
 * --max-sessions) for an explicit "look at everything" run.
 */
import {
  ClaudeCodeAdapter,
  discoverSlugSessionFiles,
  discoverSlugSubagentFiles,
  listProjectSlugs,
  sortFilesNewestFirst,
  type MalformedLine,
  type TranscriptEvent,
} from "../core/transcripts.js";
import { slugify } from "../core/paths.js";

/** Per-assistant-turn detail retained for model-aware, cache-split-aware cost math. */
export interface TurnDetail {
  model: string | undefined;
  inputTokens: number;
  cacheCreation5mInputTokens: number;
  cacheCreation1hInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
}

export interface MeasuredReality {
  /** Total session files found for this scope (before the --max-sessions cap). */
  sessionsAvailable: number;
  /** Session files actually read (<= --max-sessions). */
  sessionsScanned: number;
  /** Subagent transcript files found under <slug>/subagents/** — counted, not deep-scanned. */
  subagentSessionsAvailable: number;
  assistantTurns: number;
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
  malformedLineCount: number;
  malformedLines: MalformedLine[];
  turnDetails: TurnDetail[];
}

export interface ScanForDoctorOptions {
  cwd: string;
  all: boolean;
  maxSessions: number;
  /** Override for testing — defaults to the real ~/.claude/projects. */
  projectsDir?: string;
}

export interface ScanForDoctorResult {
  reality: MeasuredReality;
  /** Lowercased assistant text + tool_use inputs from scanned sessions, for anchor lookups. */
  corpus: string;
}

async function consumeEvents(
  events: AsyncIterable<TranscriptEvent>,
): Promise<{ reality: Omit<MeasuredReality, "sessionsAvailable" | "sessionsScanned" | "subagentSessionsAvailable" | "malformedLineCount" | "malformedLines">; corpus: string }> {
  let assistantTurns = 0;
  let inputTokens = 0;
  let cacheCreationInputTokens = 0;
  let cacheReadInputTokens = 0;
  let outputTokens = 0;
  const turnDetails: TurnDetail[] = [];
  const corpusParts: string[] = [];

  for await (const event of events) {
    if (event.role !== "assistant") continue;
    assistantTurns += 1;
    corpusParts.push(event.text);
    for (const tu of event.toolUses) {
      corpusParts.push(tu.name, tu.inputText);
    }
    if (event.usage) {
      inputTokens += event.usage.inputTokens;
      cacheCreationInputTokens += event.usage.cacheCreationInputTokens;
      cacheReadInputTokens += event.usage.cacheReadInputTokens;
      outputTokens += event.usage.outputTokens;
      turnDetails.push({
        model: event.model,
        inputTokens: event.usage.inputTokens,
        cacheCreation5mInputTokens: event.usage.cacheCreation5mInputTokens,
        cacheCreation1hInputTokens: event.usage.cacheCreation1hInputTokens,
        cacheReadInputTokens: event.usage.cacheReadInputTokens,
        outputTokens: event.usage.outputTokens,
      });
    }
  }

  return {
    reality: { assistantTurns, inputTokens, cacheCreationInputTokens, cacheReadInputTokens, outputTokens, turnDetails },
    corpus: corpusParts.join("\n").toLowerCase(),
  };
}

export async function scanForDoctor(options: ScanForDoctorOptions): Promise<ScanForDoctorResult> {
  const adapter = new ClaudeCodeAdapter(options.projectsDir);
  const malformed: MalformedLine[] = [];
  let sessionsAvailable: number;
  let chosenFiles: string[];
  let subagentSessionsAvailable: number;

  if (options.all) {
    const allFiles = await adapter.discoverFiles();
    sessionsAvailable = allFiles.length;
    const sorted = await sortFilesNewestFirst(allFiles);
    chosenFiles = sorted.slice(0, options.maxSessions);
    const slugs = await listProjectSlugs(options.projectsDir);
    const subagentCounts = await Promise.all(slugs.map((s) => discoverSlugSubagentFiles(s, options.projectsDir)));
    subagentSessionsAvailable = subagentCounts.reduce((sum, files) => sum + files.length, 0);
  } else {
    const slug = slugify(options.cwd);
    const allFiles = await discoverSlugSessionFiles(slug, options.projectsDir);
    sessionsAvailable = allFiles.length;
    const sorted = await sortFilesNewestFirst(allFiles);
    chosenFiles = sorted.slice(0, options.maxSessions);
    subagentSessionsAvailable = (await discoverSlugSubagentFiles(slug, options.projectsDir)).length;
  }

  async function* iterate(): AsyncGenerator<TranscriptEvent> {
    for (const file of chosenFiles) {
      yield* adapter.readFile(file, malformed);
    }
  }

  const { reality: partial, corpus } = await consumeEvents(iterate());

  return {
    reality: {
      sessionsAvailable,
      sessionsScanned: chosenFiles.length,
      subagentSessionsAvailable,
      ...partial,
      malformedLineCount: malformed.length,
      malformedLines: malformed,
    },
    corpus,
  };
}

export interface RuleReferenceStatus {
  referenced: boolean;
  unmeasurable: boolean;
}

/** A rule is referenced if ANY of its anchors appears in the corpus. */
export function checkRuleAgainstCorpus(anchors: string[], lowercasedCorpus: string): RuleReferenceStatus {
  if (anchors.length === 0) return { referenced: false, unmeasurable: true };
  const referenced = anchors.some((a) => lowercasedCorpus.includes(a.toLowerCase()));
  return { referenced, unmeasurable: false };
}
