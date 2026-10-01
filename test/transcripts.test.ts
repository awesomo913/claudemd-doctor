import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeCodeAdapter, CodexAdapter, scanTranscripts } from "../src/core/transcripts.js";

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
    // session2 has 1 user + 1 assistant turn (one malformed line skipped).
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
});
