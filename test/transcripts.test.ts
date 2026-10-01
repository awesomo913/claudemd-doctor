import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ClaudeCodeAdapter,
  CodexAdapter,
  discoverSlugSessionFiles,
  mapWithConcurrency,
  scanTranscripts,
  sortFilesNewestFirst,
} from "../src/core/transcripts.js";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("ClaudeCodeAdapter", () => {
  const adapter = new ClaudeCodeAdapter(path.join(FIXTURES_DIR, "claude-projects"));

  it("discovers one-level-deep *.jsonl files only", async () => {
    const files = await adapter.discoverFiles();
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.endsWith(".jsonl"))).toBe(true);
  });

  it("streams user/assistant turns, skips non-turn line types, and reports malformed lines without throwing", async () => {
    const files = await adapter.discoverFiles();
    const malformed: Parameters<typeof adapter.readFile>[1] = [];
    const events = [];
    for (const file of files) {
      for await (const event of adapter.readFile(file, malformed)) {
        events.push(event);
      }
    }

    // session1 has 1 user + 1 assistant turn (summary line skipped);
    // session2 has 1 user + 1 assistant turn. It also has two broken
    // lines: one with no `"type":"user"`/`"type":"assistant"` substring at
    // all (silently skipped by the cheap pre-filter, same as any other
    // non-turn line always was — documented trade-off, not reported) and
    // one that DOES contain the assistant-type substring but has broken
    // JSON (still parsed, still reported malformed).
    expect(events).toHaveLength(4);
    expect(malformed).toHaveLength(1);
    expect(malformed[0]?.reason).toMatch(/invalid JSON/);

    const assistantEvents = events.filter((e) => e.role === "assistant");
    expect(assistantEvents).toHaveLength(2);
    const first = assistantEvents.find((e) => e.session === "session-1");
    expect(first?.usage?.inputTokens).toBe(100);
    expect(first?.usage?.cacheCreationInputTokens).toBe(500);
    expect(first?.toolUses).toHaveLength(1);
    expect(first?.toolUses[0]?.name).toBe("Bash");
    expect(first?.toolUses[0]?.inputText).toContain("build-tool");

    // Different events in the same session file can carry different cwd —
    // matching happens per-event, not per-file.
    const secondSessionAssistant = assistantEvents.find((e) => e.session === "session-2");
    expect(secondSessionAssistant?.cwd).toBe("C:\\fixture\\other");
  });
});

describe("CodexAdapter", () => {
  const adapter = new CodexAdapter(path.join(FIXTURES_DIR, "codex-sessions"));

  it("discovers nested rollout-*.jsonl files", async () => {
    const files = await adapter.discoverFiles();
    expect(files).toHaveLength(1);
    expect(path.basename(files[0] as string)).toMatch(/^rollout-.*\.jsonl$/);
  });

  it("extracts cwd from session_meta and text from response_item messages", async () => {
    const files = await adapter.discoverFiles();
    const malformed: Parameters<typeof adapter.readFile>[1] = [];
    const events = [];
    for await (const event of adapter.readFile(files[0] as string, malformed)) {
      events.push(event);
    }
    expect(events).toHaveLength(2);
    expect(events[0]?.cwd).toBe("C:\\fixture\\codex-proj");
    expect(events[0]?.role).toBe("user");
    expect(events[1]?.role).toBe("assistant");
    expect(events[1]?.usage).toBeUndefined();
    expect(malformed).toHaveLength(0);
  });
});

describe("scanTranscripts", () => {
  it("respects maxSessions and sorts newest-first by mtime", async () => {
    const adapter = new ClaudeCodeAdapter(path.join(FIXTURES_DIR, "claude-projects"));
    const result = await scanTranscripts(adapter, { maxSessions: 1 });
    expect(result.filesScanned).toHaveLength(1);
  });

  it("reports a warnings array on the result (even when empty)", async () => {
    const adapter = new ClaudeCodeAdapter(path.join(FIXTURES_DIR, "claude-projects"));
    const result = await scanTranscripts(adapter);
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});

describe("ClaudeCodeAdapter.readFile — message.content shape (silent-failure fix)", () => {
  const adapter = new ClaudeCodeAdapter(path.join(FIXTURES_DIR, "claude-projects-content-shape"));

  it("reports a malformed line (never a silently-empty event) when content is neither an array nor a string", async () => {
    const files = await adapter.discoverFiles();
    const malformed: Parameters<typeof adapter.readFile>[1] = [];
    const events = [];
    for (const file of files) {
      for await (const event of adapter.readFile(file, malformed)) events.push(event);
    }

    // Only the second line (content: "a perfectly normal string reply")
    // should yield a real event; the first (content: null) must be
    // reported, not silently turned into an empty-text event that would
    // falsely look like "this rule was never referenced".
    expect(events).toHaveLength(1);
    expect(events[0]?.text).toBe("a perfectly normal string reply");
    expect(malformed).toHaveLength(1);
    expect(malformed[0]?.reason).toMatch(/unusable message\.content/);
  });
});

describe("ClaudeCodeAdapter.readFile — unreadable file (reliability fix)", () => {
  it("records a read-failure malformed entry and does not throw for a missing file", async () => {
    const adapter = new ClaudeCodeAdapter();
    const malformed: Parameters<typeof adapter.readFile>[1] = [];
    const events = [];
    for await (const event of adapter.readFile("C:\\this\\path\\definitely\\does\\not\\exist.jsonl", malformed)) {
      events.push(event);
    }
    expect(events).toHaveLength(0);
    expect(malformed).toHaveLength(1);
    expect(malformed[0]?.lineNumber).toBe(0);
    expect(malformed[0]?.reason).toMatch(/^read failed:/);
  });

  it("keeps scanning the rest of a batch when one file in it is unreadable", async () => {
    // A mix of one real fixture file and one missing file — the missing
    // one must not abort reading of the real one.
    const adapter = new ClaudeCodeAdapter();
    const realFile = path.join(FIXTURES_DIR, "claude-projects", "proj-a", "session1.jsonl");
    const malformed: Parameters<typeof adapter.readFile>[1] = [];
    const results = await mapWithConcurrency(
      [realFile, "C:\\missing\\also-does-not-exist.jsonl"],
      4,
      async (file) => {
        const events = [];
        for await (const event of adapter.readFile(file, malformed)) events.push(event);
        return events;
      },
    );
    expect(results[0]?.length).toBeGreaterThan(0); // the real file still produced events
    expect(results[1]?.length).toBe(0); // the missing file produced none
    expect(malformed.some((m) => m.reason.startsWith("read failed:"))).toBe(true);
  });
});

describe("mapWithConcurrency", () => {
  it("runs every item and preserves result order regardless of completion order", async () => {
    const items = [30, 10, 20, 5];
    const results = await mapWithConcurrency(items, 2, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms;
    });
    expect(results).toEqual(items);
  });

  it("never runs more than `limit` callbacks concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async (i) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return i;
    });
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("returns an empty array for an empty input without hanging", async () => {
    const results = await mapWithConcurrency<number, number>([], 4, async (i) => i);
    expect(results).toEqual([]);
  });
});

describe("warnings on non-ENOENT failures (silent-failure fix)", () => {
  const TEMP_ROOT = path.join("C:\\", `cmddoctor-transcripts-test-${process.pid}-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(TEMP_ROOT, { recursive: true });
    // A regular file, not a directory — readdir on it fails with ENOTDIR,
    // a realistic non-ENOENT failure distinct from "doesn't exist".
    writeFileSync(path.join(TEMP_ROOT, "not-a-directory"), "just a file");
  });

  afterAll(() => {
    rmSync(TEMP_ROOT, { recursive: true, force: true });
  });

  it("discoverSlugSessionFiles warns (and returns []) when the slug path is not a directory", async () => {
    const warnings: string[] = [];
    const files = await discoverSlugSessionFiles("not-a-directory", TEMP_ROOT, warnings);
    expect(files).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/readdir failed/);
  });

  it("discoverSlugSessionFiles does NOT warn for a slug that simply doesn't exist (ENOENT is expected, not an error)", async () => {
    const warnings: string[] = [];
    const files = await discoverSlugSessionFiles("totally-nonexistent-slug", TEMP_ROOT, warnings);
    expect(files).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("sortFilesNewestFirst records a stat-failure warning with the path and code, and still returns", async () => {
    const warnings: string[] = [];
    const sorted = await sortFilesNewestFirst(["C:\\does\\not\\exist.jsonl"], warnings);
    expect(sorted).toEqual(["C:\\does\\not\\exist.jsonl"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("C:\\does\\not\\exist.jsonl");
    expect(warnings[0]).toMatch(/stat failed/);
  });
});
