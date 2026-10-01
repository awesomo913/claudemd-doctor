/**
 * Scans real Claude Code transcripts once and derives both the "measured
 * reality" cost numbers and the corpus used to check whether instruction
 * rules are ever referenced. One scan feeds both, per spec's definition of
 * "scanned transcripts" being the same session set for both features.
 */
import { ClaudeCodeAdapter, scanTranscripts, type MalformedLine } from "../core/transcripts.js";

export interface MeasuredReality {
  sessionsFound: number;
  assistantTurns: number;
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
  filesScanned: number;
  malformedLineCount: number;
  malformedLines: MalformedLine[];
}

export interface ScanForDoctorOptions {
  cwd: string;
  all: boolean;
  maxSessions: number;
}

export interface ScanForDoctorResult {
  reality: MeasuredReality;
  /** Lowercased assistant text + tool_use inputs from matching sessions, for anchor lookups. */
  corpus: string;
}

export async function scanForDoctor(options: ScanForDoctorOptions): Promise<ScanForDoctorResult> {
  const adapter = new ClaudeCodeAdapter();
  const { events, malformed, filesScanned } = await scanTranscripts(adapter, {
    maxSessions: options.maxSessions,
  });

  const matchingSessions = new Set<string>();
  let assistantTurns = 0;
  let inputTokens = 0;
  let cacheCreationInputTokens = 0;
  let cacheReadInputTokens = 0;
  let outputTokens = 0;
  const corpusParts: string[] = [];

  for await (const event of events) {
    const matches = options.all || event.cwd === options.cwd;
    if (!matches) continue;

    matchingSessions.add(event.session);

    if (event.role === "assistant") {
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
      }
    }
  }

  return {
    reality: {
      sessionsFound: matchingSessions.size,
      assistantTurns,
      inputTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
      outputTokens,
      filesScanned: filesScanned.length,
      malformedLineCount: malformed.length,
      malformedLines: malformed,
    },
    corpus: corpusParts.join("\n").toLowerCase(),
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
