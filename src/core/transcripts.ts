/**
 * Streaming JSONL transcript readers, normalized into one event shape so the
 * doctor (and other tools: toktree, proveit-agent, agent-leash,
 * transcript2evals) can consume Claude Code, Codex, or (eventually) Gemini
 * CLI history the same way. No CLI imports here — this module only reads
 * files and yields data.
 */
import { createReadStream, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import { claudeProjectsDir, codexSessionsDir } from "./paths.js";

export type Role = "user" | "assistant" | "system" | "other";

export interface ToolUseEvent {
  name: string;
  /** JSON-stringified input, kept as text so anchor-matching can scan it. */
  inputText: string;
}

export interface UsageEvent {
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
}

/** One normalized transcript line/turn, regardless of source tool. */
export interface TranscriptEvent {
  source: "claude-code" | "codex" | "gemini";
  session: string;
  /** Absolute path of the file this event was read from. */
  file: string;
  ts: string | undefined;
  role: Role;
  text: string;
  toolUses: ToolUseEvent[];
  usage?: UsageEvent;
  cwd: string | undefined;
  model: string | undefined;
}

/** A line that failed to parse as JSON, or parsed but had an unusable shape. */
export interface MalformedLine {
  file: string;
  lineNumber: number;
  reason: string;
}

export interface TranscriptScanResult {
  events: AsyncIterable<TranscriptEvent>;
  /** Mutated as the iterator is drained; read after exhausting `events`. */
  malformed: MalformedLine[];
  /** Files discovered, whether or not they yielded any usable events. */
  filesScanned: string[];
}

export interface TranscriptAdapter {
  readonly source: TranscriptEvent["source"];
  /** List every session file this adapter would read, without parsing them. */
  discoverFiles(): Promise<string[]>;
  /** Stream normalized events out of one session file. */
  readFile(file: string, malformed: MalformedLine[]): AsyncGenerator<TranscriptEvent>;
}

async function* readLines(file: string): AsyncGenerator<{ line: string; lineNumber: number }> {
  const stream = createReadStream(file, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber += 1;
    if (line.trim().length === 0) continue;
    yield { line, lineNumber };
  }
}

// ---------------------------------------------------------------------------
// Claude Code adapter
// ---------------------------------------------------------------------------

interface ClaudeContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
}

interface ClaudeMessage {
  role?: string;
  model?: string;
  content?: ClaudeContentBlock[] | string;
  usage?: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
}

interface ClaudeLine {
  type?: string;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  message?: ClaudeMessage;
}

export class ClaudeCodeAdapter implements TranscriptAdapter {
  readonly source = "claude-code" as const;

  constructor(private readonly projectsDir: string = claudeProjectsDir()) {}

  async discoverFiles(): Promise<string[]> {
    if (!existsSync(this.projectsDir)) return [];
    const projectDirs = await readdir(this.projectsDir, { withFileTypes: true }).catch(() => []);
    const files: string[] = [];
    for (const entry of projectDirs) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(this.projectsDir, entry.name);
      const dirEntries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const f of dirEntries) {
        // Spec glob is `~/.claude/projects/*/*.jsonl` — one level deep only.
        // This intentionally excludes nested subagent transcripts.
        if (f.isFile() && f.name.endsWith(".jsonl")) {
          files.push(path.join(dir, f.name));
        }
      }
    }
    return files;
  }

  async *readFile(file: string, malformed: MalformedLine[]): AsyncGenerator<TranscriptEvent> {
    for await (const { line, lineNumber } of readLines(file)) {
      let parsed: ClaudeLine;
      try {
        parsed = JSON.parse(line) as ClaudeLine;
      } catch (err) {
        malformed.push({ file, lineNumber, reason: `invalid JSON: ${(err as Error).message}` });
        continue;
      }

      const type = parsed.type;
      if (type !== "user" && type !== "assistant") {
        // Lines like "summary" or "queue-operation" are valid but not
        // conversation turns — not malformed, just not yielded.
        continue;
      }

      const msg = parsed.message;
      if (!msg) {
        malformed.push({ file, lineNumber, reason: `"${type}" line missing "message"` });
        continue;
      }

      const texts: string[] = [];
      const toolUses: ToolUseEvent[] = [];
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "text" && typeof block.text === "string") {
            texts.push(block.text);
          } else if (block.type === "tool_use" && typeof block.name === "string") {
            let inputText = "";
            try {
              inputText = JSON.stringify(block.input ?? {});
            } catch {
              inputText = String(block.input);
            }
            toolUses.push({ name: block.name, inputText });
          }
        }
      } else if (typeof msg.content === "string") {
        texts.push(msg.content);
      }

      const usage = msg.usage
        ? {
            inputTokens: msg.usage.input_tokens ?? 0,
            cacheCreationInputTokens: msg.usage.cache_creation_input_tokens ?? 0,
            cacheReadInputTokens: msg.usage.cache_read_input_tokens ?? 0,
            outputTokens: msg.usage.output_tokens ?? 0,
          }
        : undefined;

      yield {
        source: "claude-code",
        session: parsed.sessionId ?? path.basename(file, ".jsonl"),
        file,
        ts: parsed.timestamp,
        role: type,
        text: texts.join("\n"),
        toolUses,
        usage,
        cwd: parsed.cwd,
        model: msg.model,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Codex adapter
// ---------------------------------------------------------------------------

interface CodexContentBlock {
  type?: string;
  text?: string;
}

interface CodexResponseItemPayload {
  type?: string;
  role?: string;
  content?: CodexContentBlock[];
}

interface CodexSessionMetaPayload {
  session_id?: string;
  cwd?: string;
  timestamp?: string;
}

interface CodexLine {
  type?: string;
  timestamp?: string;
  payload?: CodexResponseItemPayload | CodexSessionMetaPayload;
}

/**
 * Codex rollout reader. Judgment call / known limitation: Codex rollout
 * lines we observed on this machine (`session_meta`, `event_msg`,
 * `response_item`, `turn_context`) do not carry a per-turn token-usage
 * block in the same shape Claude Code does, so `usage` is always left
 * undefined here. Text is extracted from `response_item` lines whose
 * payload.type is "message". This keeps the adapter functional for the
 * `--agents` instruction-chain comparison without claiming measured costs
 * we can't actually see.
 */
export class CodexAdapter implements TranscriptAdapter {
  readonly source = "codex" as const;

  constructor(private readonly sessionsDir: string = codexSessionsDir()) {}

  async discoverFiles(): Promise<string[]> {
    if (!existsSync(this.sessionsDir)) return [];
    const files: string[] = [];
    await this.walk(this.sessionsDir, files);
    return files;
  }

  private async walk(dir: string, out: string[]): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walk(full, out);
      } else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
        out.push(full);
      }
    }
  }

  async *readFile(file: string, malformed: MalformedLine[]): AsyncGenerator<TranscriptEvent> {
    let sessionId = path.basename(file, ".jsonl");
    let cwd: string | undefined;

    for await (const { line, lineNumber } of readLines(file)) {
      let parsed: CodexLine;
      try {
        parsed = JSON.parse(line) as CodexLine;
      } catch (err) {
        malformed.push({ file, lineNumber, reason: `invalid JSON: ${(err as Error).message}` });
        continue;
      }

      if (parsed.type === "session_meta") {
        const meta = parsed.payload as CodexSessionMetaPayload | undefined;
        sessionId = meta?.session_id ?? sessionId;
        cwd = meta?.cwd;
        continue;
      }

      if (parsed.type !== "response_item") continue;
      const payload = parsed.payload as CodexResponseItemPayload | undefined;
      if (!payload || payload.type !== "message") continue;

      const role: Role =
        payload.role === "user" || payload.role === "assistant" || payload.role === "system"
          ? payload.role
          : "other";

      const texts = (payload.content ?? [])
        .filter((b) => typeof b.text === "string")
        .map((b) => b.text as string);
      if (texts.length === 0) continue;

      yield {
        source: "codex",
        session: sessionId,
        file,
        ts: parsed.timestamp,
        role,
        text: texts.join("\n"),
        toolUses: [],
        usage: undefined,
        cwd,
        model: undefined,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Gemini CLI adapter — stub
// ---------------------------------------------------------------------------

/**
 * TODO: Gemini CLI transcript format has not been inspected on this machine.
 * Stubbed per spec ("Gemini adapter may be a stub with TODO") so the
 * `--agents` comparison can still list Gemini's instruction file (GEMINI.md)
 * without fabricating transcript-scanning support.
 */
export class GeminiAdapter implements TranscriptAdapter {
  readonly source = "gemini" as const;

  async discoverFiles(): Promise<string[]> {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/require-yield
  async *readFile(_file: string, _malformed: MalformedLine[]): AsyncGenerator<TranscriptEvent> {
    // Intentionally empty — no known Gemini transcript format yet.
  }
}

// ---------------------------------------------------------------------------
// High-level scan helper
// ---------------------------------------------------------------------------

export interface ScanOptions {
  /** Newest-first cap on number of session files to read. */
  maxSessions?: number;
}

async function statMtimeMs(file: string): Promise<number> {
  const { stat } = await import("node:fs/promises");
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Discover and stream events from every session file an adapter finds,
 * newest-first, capped at `maxSessions` files. Malformed lines are counted
 * and returned, never silently dropped.
 */
export async function scanTranscripts(
  adapter: TranscriptAdapter,
  options: ScanOptions = {},
): Promise<TranscriptScanResult> {
  const allFiles = await adapter.discoverFiles();
  const withMtime = await Promise.all(
    allFiles.map(async (f) => ({ file: f, mtime: await statMtimeMs(f) })),
  );
  withMtime.sort((a, b) => b.mtime - a.mtime);
  const limit = options.maxSessions ?? allFiles.length;
  const chosen = withMtime.slice(0, limit).map((x) => x.file);

  const malformed: MalformedLine[] = [];

  async function* iterate(): AsyncGenerator<TranscriptEvent> {
    for (const file of chosen) {
      yield* adapter.readFile(file, malformed);
    }
  }

  return { events: iterate(), malformed, filesScanned: chosen };
}
