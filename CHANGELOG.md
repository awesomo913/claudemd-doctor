# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-10-01

Initial release.

### Added

- Instruction tree: every file Claude Code auto-loads for a given `cwd`
  (`~/.claude/CLAUDE.md` and its `@imports`, `~/.claude/rules/**`, project
  `CLAUDE.md`/`.claude/CLAUDE.md`/`CLAUDE.local.md` up the directory tree,
  the auto-memory `MEMORY.md`), with a per-file ≈token estimate and the
  cycle-safe, depth-capped import resolver that builds it.
- Cost projection (offline estimate) per turn / per 100 turns / per month,
  for a selectable model, against a verified Anthropic pricing table
  (source URL + verification date recorded in the output).
- Measured reality: scans real Claude Code session transcripts for the
  current project (or `--all` for every project) and reports sessions
  found vs. scanned, assistant turns, real token usage split by
  input/cache-write (5m and 1h)/cache-read/output, and the instruction
  chain's real re-send cost priced per-turn by that turn's own model.
- Unreferenced-rule detection: splits instruction files into individual
  rules, extracts distinctive anchors, and reports which rules never show
  up in scanned transcripts — gated behind a 20-session minimum, ranked by
  token cost.
- Conflict detection: near-duplicate rules and polarity conflicts
  ("always X" vs. "never X" on the same anchor) across the instruction
  chain, tuned for precision (technical anchors only, windowed polarity,
  prose-word-gated duplicates).
- `--json` (versioned schema, per-model usage aggregate by default,
  `--verbose` for full per-turn detail), `--markdown`, and a colored
  terminal report (`NO_COLOR`-aware).
- `--home` / `CLAUDEMD_DOCTOR_HOME` to point the tool at an alternate home
  directory, and a bundled synthetic demo fixture (`npm run demo`).
- `--fail-over <tokens>` for CI budget checks.
