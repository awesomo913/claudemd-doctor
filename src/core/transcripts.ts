/**
 * Streaming JSONL transcript readers, normalized into one event shape so the
 * doctor (and other tools: toktree, proveit-agent, agent-leash,
 * transcript2evals) can consume Claude Code, Codex, or (eventually) Gemini
 * CLI history the same way. No CLI imports here — this module only reads
 * files and yields data.
 */
import { createReadStream, existsSync, type Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import { claudeProjectsDir, codexSessionsDir } from "./paths.js";

/**
 * `readdir(...).catch(() => [])` looks safe but silently swallows EACCES,
 * EMFILE, EIO, and every other non-ENOENT failure the same way it swallows
 * "directory doesn't exist" — which is the only case that's actually fine
 * to treat as "nothing here". Every other error is recorded as a warning
 * and scanning continues with an empty list for that directory.
 */
async function readdirSafe(dir: string, warnings: string[]): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      warnings.push(`${dir}: readdir failed (${code ?? (err as Error).message})`);
    }
    return [];
  }
}

/**
 * Run `fn` over `items` with at most `limit` in flight at once. Used to
 * read session files with bounded concurrency instead of one at a time —
 * file processing is a mix of disk I/O (which overlaps nicely) and
 * JSON/regex CPU work (which doesn't, but overlapping the I/O wait of one
 * file with the CPU work of another is still a net win).
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      const item = items[i] as T;
      results[i] = await fn(item, i);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker());
  await Promise.all(workers);
  return results;
}

export type Role = "user" | "assistant" | "system" | "other";

export interface ToolUseEvent {
  name: string;
  /** JSON-stringified input, kept as text so anchor-matching can scan it. */
  inputText: string;
}

export interface UsageEvent {
  inputTokens: number;
  /** Sum of the two ephemeral cache-write buckets below. */
  cacheCreationInputTokens: number;
  /** Cache-write tokens billed at the 5-minute TTL rate. */
  cacheCreation5mInputTokens: number;
  /** Cache-write tokens billed at the 1-hour TTL rate. */
  cacheCreation1hInputTokens: number;
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
  /** Non-fatal problems (unreadable directories, stat failures, ...) — never a silent skip. */
  warnings: string[];
}

export interface TranscriptAdapter {
  readonly source: TranscriptEvent["source"];
  /** List every session file this adapter would read, without parsing them. Appends to `warnings` on non-ENOENT readdir failures. */
  discoverFiles(warnings?: string[]): Promise<string[]>;
  /** Stream normalized events out of one session file. */
  readFile(file: string, malformed: MalformedLine[]): AsyncGenerator<TranscriptEvent>;
}

/**
 * Stream-error hardening: a file deleted, locked, or made unreadable mid-scan
 * (realistic — Claude Code writes these live while a session is in
 * progress) emits an 'error' event on the underlying stream. Node streams
 * crash the process on an unhandled 'error' event, and readline's async
 * iterator does not translate that into a rejection on its own — so we
 * attach our own listener, record the error, and surface it as a thrown
 * error once the (now-closed) stream stops producing lines, rather than
 * letting it either crash the process or vanish silently.
 */
async function* readLines(file: string): AsyncGenerator<{ line: string; lineNumber: number }> {
  const stream = createReadStream(file, { encoding: "utf8" });
  let streamError: Error | undefined;
  stream.on("error", (err) => {
    streamError = err;
  });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of rl) {
      if (streamError) throw streamError;
      lineNumber += 1;
      if (line.trim().length === 0) continue;
      yield { line, lineNumber };
    }
    if (streamError) throw streamError;
  } finally {
    rl.close();
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
    cache_creation?: {
      ephemeral_5m_input_tokens?: number;
      ephemeral_1h_input_tokens?: number;
    };
  };
}

interface ClaudeLine {
  type?: string;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  message?: ClaudeMessage;
}

/**
 * Cheap pre-filter run BEFORE JSON.parse: on a real transcript roughly half
 * the lines are types we'd discard anyway (summary, queue-operation, hook
 * output, ...). A plain substring check is far cheaper than parsing and
 * then throwing the result away. Trade-off, intentional: a line that is
 * both (a) not one of these two types and (b) invalid JSON will no longer
 * be reported as "malformed invalid JSON" — it's skipped the same way a
 * valid non-conversation line always was. A line that IS a user/assistant
 * turn but has broken JSON elsewhere in it still contains this substring
 * and is still parsed (and still reported malformed if parsing fails).
 */
function looksLikeUserOrAssistantLine(line: string): boolean {
  return line.includes('"type":"user"') || line.includes('"type":"assistant"');
}

export class ClaudeCodeAdapter implements TranscriptAdapter {
  readonly source = "claude-code" as const;

  constructor(private readonly projectsDir: string = claudeProjectsDir()) {}

  async discoverFiles(warnings: string[] = []): Promise<string[]> {
    if (!existsSync(this.projectsDir)) return [];
    const projectDirs = await readdirSafe(this.projectsDir, warnings);
    const files: string[] = [];
    for (const entry of projectDirs) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(this.projectsDir, entry.name);
      const dirEntries = await readdirSafe(dir, warnings);
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
    try {
      for await (const { line, lineNumber } of readLines(file)) {
        if (!looksLikeUserOrAssistantLine(line)) continue;

        let parsed: ClaudeLine;
        try {
          parsed = JSON.parse(line) as ClaudeLine;
        } catch (err) {
          malformed.push({ file, lineNumber, reason: `invalid JSON: ${(err as Error).message}` });
          continue;
        }

        const type = parsed.type;
        if (type !== "user" && type !== "assistant") {
          // The substring check above is a heuristic, not a guarantee —
          // double-check the real parsed type before trusting it.
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
        } else {
          // Neither an array of content blocks nor a plain string — e.g.
          // null, a number, or missing entirely. Yielding an empty-text
          // event here would silently look like "this turn said nothing",
          // which can falsely mark rules "never referenced" even though
          // the real content just couldn't be read. Report it instead.
          malformed.push({
            file,
            lineNumber,
            reason: `"${type}" line has unusable message.content (${msg.content === undefined ? "missing" : typeof msg.content})`,
          });
          continue;
        }

        const usage = msg.usage
          ? {
              inputTokens: msg.usage.input_tokens ?? 0,
              cacheCreationInputTokens: msg.usage.cache_creation_input_tokens ?? 0,
              cacheCreation5mInputTokens: msg.usage.cache_creation?.ephemeral_5m_input_tokens ?? 0,
              cacheCreation1hInputTokens: msg.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
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
    } catch (err) {
      // The file itself became unreadable mid-scan (deleted, locked, I/O
      // error) — Claude Code writes these live, so this is a realistic
      // race, not a hypothetical. Report it and stop reading this file;
      // never let one bad file abort the whole report.
      const code = (err as NodeJS.ErrnoException).code ?? (err as Error).message;
      malformed.push({ file, lineNumber: 0, reason: `read failed: ${code}` });
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

  async discoverFiles(warnings: string[] = []): Promise<string[]> {
    if (!existsSync(this.sessionsDir)) return [];
    const files: string[] = [];
    await this.walk(this.sessionsDir, files, warnings);
    return files;
  }

  private async walk(dir: string, out: string[], warnings: string[]): Promise<void> {
    const entries = await readdirSafe(dir, warnings);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walk(full, out, warnings);
      } else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
        out.push(full);
      }
    }
  }

  async *readFile(file: string, malformed: MalformedLine[]): AsyncGenerator<TranscriptEvent> {
    let sessionId = path.basename(file, ".jsonl");
    let cwd: string | undefined;

    try {
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
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? (err as Error).message;
      malformed.push({ file, lineNumber: 0, reason: `read failed: ${code}` });
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

  async discoverFiles(_warnings: string[] = []): Promise<string[]> {
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
  /** How many files to read concurrently (default 4). */
  concurrency?: number;
  /** Called after each batch finishes, with (filesDoneSoFar, totalFiles). */
  onProgress?: (done: number, total: number) => void;
}

async function statMtimeMs(file: string, warnings: string[]): Promise<number> {
  const { stat } = await import("node:fs/promises");
  try {
    return (await stat(file)).mtimeMs;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? (err as Error).message;
    warnings.push(`${file}: stat failed (${code})`);
    return 0;
  }
}

/** Sort files newest-first by mtime. Shared by the global and scoped scan paths. */
export async function sortFilesNewestFirst(files: string[], warnings: string[] = []): Promise<string[]> {
  const withMtime = await Promise.all(files.map(async (f) => ({ file: f, mtime: await statMtimeMs(f, warnings) })));
  withMtime.sort((a, b) => b.mtime - a.mtime);
  return withMtime.map((x) => x.file);
}

/**
 * Discover and stream events from every session file an adapter finds,
 * newest-first, capped at `maxSessions` files. Malformed lines are counted
 * and returned, never silently dropped. Files are read with bounded
 * concurrency rather than strictly one-at-a-time.
 */
export async function scanTranscripts(
  adapter: TranscriptAdapter,
  options: ScanOptions = {},
): Promise<TranscriptScanResult> {
  const warnings: string[] = [];
  const allFiles = await adapter.discoverFiles(warnings);
  const sorted = await sortFilesNewestFirst(allFiles, warnings);
  const limit = options.maxSessions ?? allFiles.length;
  const chosen = sorted.slice(0, limit);

  const malformed: MalformedLine[] = [];
  const concurrency = options.concurrency ?? 4;

  async function* iterate(): AsyncGenerator<TranscriptEvent> {
    // Read up to `concurrency` files at once, buffering each file's events
    // (a single session file's events easily fit in memory) so later files
    // don't block earlier ones waiting on disk I/O, while still yielding
    // everything in a stable, deterministic (newest-file-first) order.
    for (let i = 0; i < chosen.length; i += concurrency) {
      const batch = chosen.slice(i, i + concurrency);
      const batchEvents = await Promise.all(
        batch.map(async (file) => {
          const events: TranscriptEvent[] = [];
          for await (const event of adapter.readFile(file, malformed)) events.push(event);
          return events;
        }),
      );
      for (const events of batchEvents) yield* events;
      options.onProgress?.(Math.min(i + batch.length, chosen.length), chosen.length);
    }
  }

  return { events: iterate(), malformed, filesScanned: chosen, warnings };
}

// ---------------------------------------------------------------------------
// Scoped-by-project-slug discovery (Claude Code only)
//
// The doctor's default (non-"--all") mode should look directly at
// ~/.claude/projects/<slug>/ instead of scanning the newest N files across
// every project on the machine and then filtering by cwd — the latter
// starves small/quiet projects of their own history once the machine has
// thousands of sessions elsewhere. --all keeps the cross-project behavior
// via ClaudeCodeAdapter.discoverFiles() + scanTranscripts() above.
// ---------------------------------------------------------------------------

/** Every *.jsonl session file directly inside one project's slug directory (not recursive). */
export async function discoverSlugSessionFiles(
  slug: string,
  projectsDir: string = claudeProjectsDir(),
  warnings: string[] = [],
): Promise<string[]> {
  const dir = path.join(projectsDir, slug);
  if (!existsSync(dir)) return [];
  const entries = await readdirSafe(dir, warnings);
  return entries.filter((e) => e.isFile() && e.name.endsWith(".jsonl")).map((e) => path.join(dir, e.name));
}

/** Every *.jsonl file under <slug>/subagents/**, recursively. Counted separately from main sessions. */
export async function discoverSlugSubagentFiles(
  slug: string,
  projectsDir: string = claudeProjectsDir(),
  warnings: string[] = [],
): Promise<string[]> {
  const dir = path.join(projectsDir, slug, "subagents");
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    const entries = await readdirSafe(d, warnings);
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        out.push(full);
      }
    }
  }
  await walk(dir);
  return out;
}

/** List every project slug directory under ~/.claude/projects (for --all's subagent count). */
export async function listProjectSlugs(projectsDir: string = claudeProjectsDir(), warnings: string[] = []): Promise<string[]> {
  if (!existsSync(projectsDir)) return [];
  const entries = await readdirSafe(projectsDir, warnings);
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}
