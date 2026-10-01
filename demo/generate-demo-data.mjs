#!/usr/bin/env node
/**
 * Regenerates the ~30 synthetic transcripts under
 * demo/home/.claude/projects/D--demo-project/*.jsonl.
 *
 * These are entirely synthetic — no real transcript content, no real
 * usernames or paths. They exist so `npm run demo` has real-looking
 * "measured reality" numbers to show without reading anything from the
 * machine that happens to run it. Anchors from the demo's "normal" rules
 * (npm test, npm, pnpm, main, feat:/fix:/docs:, npm run build/dev) are
 * sprinkled across sessions so those rules show up as referenced; the four
 * "legacy/retired/archived" rule files are never mentioned anywhere here,
 * so the doctor's unreferenced-rules check finds exactly those four.
 *
 * Run with: node demo/generate-demo-data.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "home", ".claude", "projects", "D--demo-project");
mkdirSync(outDir, { recursive: true });

const CWD = "D:\\demo-project";
const MODEL = "claude-sonnet-5";

// A pool of short, varied assistant replies that each touch a different
// mix of the "normal" rules' anchors, so the 30 sessions collectively
// reference git-workflow.md, testing.md, code-style.md, security.md,
// error-handling.md and MEMORY.md — but never the four retired/legacy files.
const REPLY_POOL = [
  "Ran `npm test` and the suite is green, opening the pull request now.",
  "Installed the new dependency with `npm install` and committed the lockfile.",
  "Switched this branch to `pnpm install` per the team convention and re-ran the build.",
  "Committed as `feat: add retry to the upload handler`.",
  "Committed as `fix: handle empty input in the parser`.",
  "Rebased onto `main` before opening the pull request, no conflicts.",
  "Added a `docs:` commit updating the README for the new flag.",
  "Wrote a happy-path test and a failure-case test for the new validator.",
  "Mocked the external API call in the unit test instead of hitting the real endpoint.",
  "Ran `npm run build` locally to confirm the production bundle still compiles.",
  "Started the dev server with `npm run dev` to check the change in the browser.",
  "Renamed the boolean to `isReady` so the call site reads naturally.",
  "Split the long function into three smaller ones, each with a single responsibility.",
  "Added input validation at the API boundary before it reaches the business logic.",
  "Re-threw the error with added context instead of swallowing it in the catch block.",
  "Left a review comment as a question rather than a command, per the review convention.",
  "Squash-merged the pull request and deleted the feature branch afterward.",
  "Bumped the package version in `package.json` for this release, following semver.",
  "Logged the auth failure with enough context to investigate later.",
  "Tagged the relevant reviewers since this touches the public API surface.",
];

const USER_PROMPTS = [
  "Can you add a test for the new validator?",
  "Please fix the bug where empty input crashes the parser.",
  "Switch the install step over to pnpm like we agreed.",
  "Open a PR for this once the suite passes.",
  "Clean up this function, it's doing too much.",
  "Make sure this error path logs enough context.",
  "Rebase this branch before I review it.",
  "Bump the version and tag the reviewers.",
];

function iso(daysAgo, idx) {
  const d = new Date(Date.UTC(2026, 8, 1, 12, 0, 0));
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCMinutes(d.getUTCMinutes() + idx);
  return d.toISOString();
}

function usageFor(idx) {
  // Sized so the average per-turn context comfortably exceeds the demo's
  // ~8.7k-token instruction chain (as a real coding-agent turn's context —
  // conversation history, file contents, tool output — normally does),
  // landing the "instructions as % of request" headline in a believable
  // 15-40% range instead of an impossible >100%.
  const base = 9000 + (idx % 7) * 900; // first-turn-in-session cache write
  const read = idx % 4 === 0 ? 0 : 21000 + (idx % 11) * 1400; // later-turn cache hit
  return {
    input_tokens: 30 + (idx % 5) * 4,
    cache_creation_input_tokens: base,
    cache_read_input_tokens: read,
    output_tokens: 80 + (idx % 9) * 15,
    cache_creation: {
      ephemeral_5m_input_tokens: base,
      ephemeral_1h_input_tokens: 0,
    },
  };
}

const SESSION_COUNT = 30;
for (let s = 0; s < SESSION_COUNT; s += 1) {
  const sessionId = `demo-session-${String(s + 1).padStart(4, "0")}`;
  const lines = [];
  const turnsInSession = 2 + (s % 3); // 2-4 assistant turns per session
  const userPrompt = USER_PROMPTS[s % USER_PROMPTS.length];

  lines.push(
    JSON.stringify({
      type: "user",
      sessionId,
      cwd: CWD,
      timestamp: iso(SESSION_COUNT - s, 0),
      message: { role: "user", content: [{ type: "text", text: userPrompt }] },
    }),
  );

  for (let t = 0; t < turnsInSession; t += 1) {
    const replyText = REPLY_POOL[(s * 3 + t) % REPLY_POOL.length];
    lines.push(
      JSON.stringify({
        type: "assistant",
        sessionId,
        cwd: CWD,
        timestamp: iso(SESSION_COUNT - s, t + 1),
        message: {
          role: "assistant",
          model: MODEL,
          content: [{ type: "text", text: replyText }],
          usage: usageFor(s * 7 + t),
        },
      }),
    );
  }

  writeFileSync(path.join(outDir, `${sessionId}.jsonl`), `${lines.join("\n")}\n`, "utf8");
}

console.log(`Wrote ${SESSION_COUNT} synthetic session files to ${outDir}`);
