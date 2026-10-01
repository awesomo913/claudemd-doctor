/**
 * Scans real Claude Code transcripts once and derives both the "measured
 * reality" cost numbers and the corpus used to check whether instruction
 * rules are ever referenced.
 *
 * Session discovery (precision fix): the default (non-"--all") mode goes
 * straight to `~/.claude/projects/<slug>/` for this cwd instead of scanning
 * the newest N files machine-wide and filtering by cwd — on a machine with
 * thousands of sessions across many projects, that global scan starved
 * small/quiet projects down to a handful of matches. `--all` keeps the old
 * cross-project behavior (every project, newest-first, capped at
 * --max-sessions) for an explicit "look at everything" run.
 *
 * Reliability (silent-failure pass): files are read with bounded
 * concurrency and one bad file (deleted/locked/unreadable mid-scan — a
 * realistic race, Claude Code writes these live) never aborts the whole
 * report; it's recorded and the scan continues.
 */
import {
  ClaudeCodeAdapter,
  discoverSlugSessionFiles,
  discoverSlugSubagentFiles,
  listProjectSlugs,
  mapWithConcurrency,
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
  /** Session files actually attempted (<= --max-sessions). */
  sessionsScanned: number;
  /** Of sessionsScanned, how many failed to read at all (deleted/locked/I-O error) — never silently dropped. */
  sessionsUnreadable: number;
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
  /** Non-fatal problems while discovering/sorting session files (unreadable dirs, stat failures, ...). */
  warnings: string[];
}

export interface ScanForDoctorOptions {
  cwd: string;
  all: boolean;
  maxSessions: number;
  /** Override for testing — defaults to the real ~/.claude/projects. */
  projectsDir?: string;
  /** How many session files to read concurrently (default 4). */
  concurrency?: number;
  /** Called after each file finishes, with (filesDoneSoFar, totalFiles). */
  onProgress?: (done: number, total: number) => void;
}

export interface ScanForDoctorResult {
  reality: MeasuredReality;
  /** Lowercased assistant text + tool_use inputs from scanned sessions, for anchor lookups. */
  corpus: string;
}

interface FilePartial {
  assistantTurns: number;
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
  turnDetails: TurnDetail[];
  corpusParts: string[];
}

function emptyPartial(): FilePartial {
  return { assistantTurns: 0, inputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 0, turnDetails: [], corpusParts: [] };
}

async function readOneFile(adapter: ClaudeCodeAdapter, file: string, malformed: MalformedLine[]): Promise<FilePartial> {
  const partial = emptyPartial();
  for await (const event of adapter.readFile(file, malformed)) {
    if (event.role !== "assistant") continue;
    partial.assistantTurns += 1;
    partial.corpusParts.push(event.text);
    for (const tu of event.toolUses) partial.corpusParts.push(tu.name, tu.inputText);
    if (event.usage) {
      partial.inputTokens += event.usage.inputTokens;
      partial.cacheCreationInputTokens += event.usage.cacheCreationInputTokens;
      partial.cacheReadInputTokens += event.usage.cacheReadInputTokens;
      partial.outputTokens += event.usage.outputTokens;
      partial.turnDetails.push({
        model: event.model,
        inputTokens: event.usage.inputTokens,
        cacheCreation5mInputTokens: event.usage.cacheCreation5mInputTokens,
        cacheCreation1hInputTokens: event.usage.cacheCreation1hInputTokens,
        cacheReadInputTokens: event.usage.cacheReadInputTokens,
        outputTokens: event.usage.outputTokens,
      });
    }
  }
  return partial;
}

function mergePartials(parts: FilePartial[]): Omit<MeasuredReality, "sessionsAvailable" | "sessionsScanned" | "sessionsUnreadable" | "subagentSessionsAvailable" | "malformedLineCount" | "malformedLines" | "warnings"> & { corpus: string } {
  let assistantTurns = 0;
  let inputTokens = 0;
  let cacheCreationInputTokens = 0;
  let cacheReadInputTokens = 0;
  let outputTokens = 0;
  const turnDetails: TurnDetail[] = [];
  const corpusParts: string[] = [];

  for (const p of parts) {
    assistantTurns += p.assistantTurns;
    inputTokens += p.inputTokens;
    cacheCreationInputTokens += p.cacheCreationInputTokens;
    cacheReadInputTokens += p.cacheReadInputTokens;
    outputTokens += p.outputTokens;
    turnDetails.push(...p.turnDetails);
    corpusParts.push(...p.corpusParts);
  }

  return {
    assistantTurns,
    inputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    outputTokens,
    turnDetails,
    corpus: corpusParts.join("\n").toLowerCase(),
  };
}

/** Count distinct files that hit a whole-file read failure (see transcripts.ts readFile's catch). */
function countUnreadableFiles(malformed: MalformedLine[]): number {
  return new Set(malformed.filter((m) => m.reason.startsWith("read failed:")).map((m) => m.file)).size;
}

export async function scanForDoctor(options: ScanForDoctorOptions): Promise<ScanForDoctorResult> {
  const adapter = new ClaudeCodeAdapter(options.projectsDir);
  const malformed: MalformedLine[] = [];
  const warnings: string[] = [];
  let sessionsAvailable: number;
  let chosenFiles: string[];
  let subagentSessionsAvailable: number;

  if (options.all) {
    const allFiles = await adapter.discoverFiles(warnings);
    sessionsAvailable = allFiles.length;
    const sorted = await sortFilesNewestFirst(allFiles, warnings);
    chosenFiles = sorted.slice(0, options.maxSessions);
    const slugs = await listProjectSlugs(options.projectsDir, warnings);
    const subagentCounts = await Promise.all(slugs.map((s) => discoverSlugSubagentFiles(s, options.projectsDir, warnings)));
    subagentSessionsAvailable = subagentCounts.reduce((sum, files) => sum + files.length, 0);
  } else {
    const slug = slugify(options.cwd);
    const allFiles = await discoverSlugSessionFiles(slug, options.projectsDir, warnings);
    sessionsAvailable = allFiles.length;
    const sorted = await sortFilesNewestFirst(allFiles, warnings);
    chosenFiles = sorted.slice(0, options.maxSessions);
    subagentSessionsAvailable = (await discoverSlugSubagentFiles(slug, options.projectsDir, warnings)).length;
  }

  let done = 0;
  const parts = await mapWithConcurrency(chosenFiles, options.concurrency ?? 4, async (file) => {
    const partial = await readOneFile(adapter, file, malformed);
    done += 1;
    options.onProgress?.(done, chosenFiles.length);
    return partial;
  });

  const merged = mergePartials(parts);

  return {
    reality: {
      sessionsAvailable,
      sessionsScanned: chosenFiles.length,
      sessionsUnreadable: countUnreadableFiles(malformed),
      subagentSessionsAvailable,
      assistantTurns: merged.assistantTurns,
      inputTokens: merged.inputTokens,
      cacheCreationInputTokens: merged.cacheCreationInputTokens,
      cacheReadInputTokens: merged.cacheReadInputTokens,
      outputTokens: merged.outputTokens,
      turnDetails: merged.turnDetails,
      malformedLineCount: malformed.length,
      malformedLines: malformed,
      warnings,
    },
    corpus: merged.corpus,
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
