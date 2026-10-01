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

/**
 * Realistic cache-read-vs-write split: the FIRST assistant turn of a
 * session writes the instruction chain into cache (cache_creation, no
 * read yet); every later turn mostly re-reads that same growing cached
 * prefix (cache_read) and only writes a small increment for its own new
 * content. On a real machine's measured StolenEmerald history, ~98% of
 * input-side tokens are cache reads — the first synthetic demo data set
 * had this backwards (big writes every turn), making "cached" look only
 * ~38% cheaper than "uncached" instead of the realistic ~10x.
 *
 * `turnIndexInSession` is 0-indexed within its session.
 */
function usageFor(turnIndexInSession) {
  const CHAIN_APPROX = 8700; // close to the demo's real ≈8,686-token chain

  if (turnIndexInSession === 0) {
    return {
      input_tokens: 25,
      cache_creation_input_tokens: CHAIN_APPROX,
      cache_read_input_tokens: 0,
      output_tokens: 90,
      cache_creation: { ephemeral_5m_input_tokens: CHAIN_APPROX, ephemeral_1h_input_tokens: 0 },
    };
  }

  const smallWrite = 90; // this turn's own new content joining the cache — flat, not growing with session length
  const growingRead = CHAIN_APPROX + turnIndexInSession * 1500; // the whole prefix so far, re-read
  return {
    input_tokens: 20 + turnIndexInSession * 2,
    cache_creation_input_tokens: smallWrite,
    cache_read_input_tokens: growingRead,
    output_tokens: 70 + turnIndexInSession * 10,
    cache_creation: { ephemeral_5m_input_tokens: smallWrite, ephemeral_1h_input_tokens: 0 },
  };
}

const SESSION_COUNT = 30;
for (let s = 0; s < SESSION_COUNT; s += 1) {
  const sessionId = `demo-session-${String(s + 1).padStart(4, "0")}`;
  const lines = [];
  // Longer sessions than a short demo would normally bother with — needed
  // so the read-dominated turns actually outweigh each session's one-time
  // cache-write turn, matching the ratio a real multi-hour session shows.
  const turnsInSession = 150 + (s % 60); // 150-209 assistant turns per session
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
          usage: usageFor(t),
        },
      }),
    );
  }

  writeFileSync(path.join(outDir, `${sessionId}.jsonl`), `${lines.join("\n")}\n`, "utf8");
}

console.log(`Wrote ${SESSION_COUNT} synthetic session files to ${outDir}`);
