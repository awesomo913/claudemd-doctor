# claudemd-doctor — v0.1 spec (locked 2026-10-01)

One-liner: **See what your CLAUDE.md costs you on every single turn — and which rules never pull their weight.**
Run: `npx claudemd-doctor` (in any project dir). Node >= 20, TypeScript, ESM, zero required config, fully offline by default.

## What it reports
1. **Instruction tree** — every file Claude Code auto-loads for the current cwd, in load order, as a tree with
   per-file tokens (≈) and % of total:
   - user: `~/.claude/CLAUDE.md` (+ its `@imports`, recursively, cycle-safe, max depth 5), `~/.claude/rules/**/*.md`
   - project: `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md` in cwd and every parent dir up to fs root
   - `@path` imports inside any of those (relative to the importing file; `~` expanded); skip imports inside code fences/inline code
   - auto-memory: `~/.claude/projects/<slug>/memory/MEMORY.md` where slug = cwd with `:`,`\`,`/` replaced by `-`
     (verify slug rule against real dirs in ~/.claude/projects, e.g. `C:\` -> `C--`)
   - `--agents` flag also shows `AGENTS.md` (Codex) and `GEMINI.md` (Gemini CLI) chains for comparison
   - Missing/unreadable import → listed as a warning row, never a silent skip.
2. **Cost** — total ≈tokens per turn; estimated $ per turn / per 100 turns / per month at a configurable turns/day
   (default 200), shown both uncached and cache-read price, for a selectable model (default sonnet). Pricing table in
   one data file `src/core/pricing.ts` with a "last verified" date. Label every token figure "≈" (offline estimate).
3. **Measured reality (killer feature)** — scan the user's real Claude Code transcripts
   (`~/.claude/projects/*/*.jsonl`) for sessions whose `cwd` matches this project (or `--all`), and report:
   sessions found, turns, and how many times the instruction chain was re-sent (= assistant turns), plus real
   cache_creation / cache_read token totals from `message.usage`. Show "your instructions were sent N times ≈ X tokens ≈ $Y".
   Must stream large files line by line; tolerate malformed lines (count them, report count).
4. **Unreferenced rules** — split each file into rules (bullet items and paragraphs under headings). For each rule
   extract distinctive anchors (backticked tokens, file paths, command names, ALL_CAPS words, quoted phrases). A rule
   is "referenced" if any anchor appears in assistant text or tool_use inputs in the scanned transcripts. Report rules
   with zero references over N sessions as "never referenced in N sessions" — wording must NOT claim they are useless.
   Rules with no extractable anchors → "unmeasurable", listed separately (not counted as dead).
5. **Conflicts & duplicates** (heuristic, offline) — near-duplicate rules across files (normalized text similarity
   >= 0.85), and polarity conflicts: same anchor/object with "always/must/use" vs "never/don't/avoid". Each finding
   shows both file:line locations.

## Output modes
- default: pretty terminal (colors via a small dep like picocolors; tree with box chars; respects NO_COLOR and non-TTY)
- `--json` (stable schema, documented in README), `--markdown` (for pasting in issues/PRs)
- `--max-sessions N` (default 200, newest first), `--model`, `--turns-per-day`, `--no-transcripts`, `--cwd <dir>`
- exit code 0 normally; `--fail-over <tokens>` exits 1 if total exceeds budget (for CI).

## Shared core (will be reused by toktree, proveit-agent, agent-leash, transcript2evals) — keep it in `src/core/` with no CLI imports
- `transcripts.ts`: async iterator over Claude Code JSONL sessions (also Codex `~/.codex/sessions/**/rollout-*.jsonl`
  behind an adapter interface; Gemini adapter may be a stub with TODO). Normalized event type: {session, ts, role, text, toolUses[], usage?, cwd, model}.
- `tokens.ts`: `countTokens(text)` offline estimate (use `js-tiktoken` o200k_base as the estimator; document that
  Claude's tokenizer differs, ~±15%); interface allows a future `--exact` mode via Anthropic count_tokens API (not in v0.1).
- `pricing.ts`, `paths.ts` (home/slug resolution, Windows + macOS + Linux).

## Quality bar
- vitest unit tests for: import resolution (cycles, missing, code-fence skip), slug rule, rule splitting/anchor
  extraction, conflict detection, transcript parsing (malformed lines), cost math.
- Fixtures are SYNTHETIC — never copy real transcript content or real CLAUDE.md text into the repo (privacy).
- Errors are explicit: no empty catch blocks; unreadable file → warning row + stderr note; never swallow.
- `npm run build` (tsup) → `dist/cli.js` with shebang; `bin: { "claudemd-doctor": "dist/cli.js" }`.
- Must run on Windows (this dev machine) — path handling via node:path, homedir via os.homedir().
- Performance: full run over 200 sessions < 10 s on this machine.
