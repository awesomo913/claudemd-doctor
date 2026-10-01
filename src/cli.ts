import { parseArgs } from "node:util";
import process from "node:process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildDoctorReport, DEFAULT_MODEL_ALIAS } from "./doctor/report.js";
import { renderJson, renderMarkdown, renderPretty } from "./doctor/render.js";
import { claudeProjectsDir } from "./core/paths.js";

function readOwnVersion(): string {
  try {
    const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0"; // never crash --version over a missing/unreadable package.json
  }
}

const HELP = `claudemd-doctor — see what your CLAUDE.md costs you on every single turn.

Usage: claudemd-doctor [options]

Scope
  --cwd <dir>            Analyze this directory instead of the current one
  --home <dir>           Use this directory as home (~/.claude lives under it) instead
                         of the real one (also: CLAUDEMD_DOCTOR_HOME env var)
  --all                  Include transcripts from every project, not just this cwd
  --agents               Also show AGENTS.md (Codex) / GEMINI.md chains for comparison

Transcripts
  --max-sessions <n>     Newest-N transcript files to scan (default 200)
  --no-transcripts       Skip the measured-reality / unreferenced-rules scan entirely

Cost
  --model <name>         Pricing model: sonnet (default), opus, haiku, ...
  --turns-per-day <n>    Turns/day used for the monthly cost projection (default 200)
  --fail-over <tokens>   Exit 1 if the instruction tree exceeds this many ≈tokens

Output
  --json                 Output machine-readable JSON (stable schema)
  --markdown             Output markdown (for pasting into issues/PRs)
  --verbose              JSON mode only: include full per-turn detail, not just per-model totals
  --all-rules            Pretty/markdown mode: show every unreferenced rule, not just the top 10

  -h, --help             Show this help
  -v, --version          Show the installed version

Examples
  npx claudemd-doctor
      Analyze the current directory and print a pretty report.

  npx claudemd-doctor --json --max-sessions 500 > report.json
      Machine-readable report over the newest 500 sessions for this project.

  npx claudemd-doctor --fail-over 20000
      CI-friendly: exit 1 if the instruction chain exceeds 20,000 ≈tokens.
`;

interface CliArgs {
  cwd?: string;
  home?: string;
  json?: boolean;
  markdown?: boolean;
  verbose?: boolean;
  model?: string;
  "turns-per-day"?: string;
  "max-sessions"?: string;
  all?: boolean;
  "no-transcripts"?: boolean;
  agents?: boolean;
  "fail-over"?: string;
  "all-rules"?: boolean;
  help?: boolean;
  version?: boolean;
}

function parseIntOption(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`invalid --${name}: "${value}" is not a positive integer`);
  }
  return n;
}

async function main(): Promise<void> {
  let values: CliArgs;
  try {
    const parsed = parseArgs({
      args: process.argv.slice(2),
      options: {
        cwd: { type: "string" },
        home: { type: "string" },
        json: { type: "boolean" },
        markdown: { type: "boolean" },
        verbose: { type: "boolean" },
        model: { type: "string" },
        "turns-per-day": { type: "string" },
        "max-sessions": { type: "string" },
        all: { type: "boolean" },
        "no-transcripts": { type: "boolean" },
        agents: { type: "boolean" },
        "fail-over": { type: "string" },
        "all-rules": { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
      allowPositionals: false,
    });
    values = parsed.values as CliArgs;
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n\n${HELP}`);
    process.exitCode = 1;
    return;
  }

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  if (values.version) {
    process.stdout.write(`${readOwnVersion()}\n`);
    return;
  }

  let turnsPerDay: number;
  let maxSessions: number;
  let failOverTokens: number | undefined;
  try {
    turnsPerDay = parseIntOption(values["turns-per-day"], "turns-per-day", 200);
    maxSessions = parseIntOption(values["max-sessions"], "max-sessions", 200);
    failOverTokens = values["fail-over"] !== undefined ? parseIntOption(values["fail-over"], "fail-over", 0) : undefined;
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exitCode = 1;
    return;
  }

  const cwd = values.cwd ? values.cwd : process.cwd();
  // --home (or CLAUDEMD_DOCTOR_HOME) points the whole tool at a different
  // "home directory" — used for the bundled demo fixtures and for anyone
  // who wants to point the doctor at a snapshot of someone else's
  // ~/.claude without touching their own.
  const homeDir = values.home ?? process.env.CLAUDEMD_DOCTOR_HOME;
  const projectsDir = homeDir ? claudeProjectsDir(homeDir) : undefined;

  // Progress line only when stderr is an interactive TTY and we're not
  // emitting machine-readable JSON (which must stay clean on stdout, and a
  // TTY check avoids spamming log files/CI output with carriage returns).
  const showProgress = Boolean(process.stderr.isTTY) && !values.json;
  const onProgress = showProgress
    ? (done: number, total: number) => {
        process.stderr.write(`\rscanning ${done}/${total} sessions…${done >= total ? "\n" : ""}`);
      }
    : undefined;

  const report = await buildDoctorReport({
    cwd,
    modelAlias: values.model ?? DEFAULT_MODEL_ALIAS,
    turnsPerDay,
    maxSessions,
    all: Boolean(values.all),
    includeTranscripts: !values["no-transcripts"],
    includeAgents: Boolean(values.agents),
    failOverTokens,
    homeDir,
    projectsDir,
    onProgress,
  });

  const renderOptions = { showAllRules: Boolean(values["all-rules"]), verbose: Boolean(values.verbose) };

  if (values.json) {
    process.stdout.write(`${renderJson(report, renderOptions)}\n`);
  } else if (values.markdown) {
    process.stdout.write(`${renderMarkdown(report, renderOptions)}\n`);
  } else {
    process.stdout.write(`${renderPretty(report, renderOptions)}\n`);
  }

  if (report.failOverExceeded) {
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`claudemd-doctor: fatal error: ${(err as Error).stack ?? String(err)}\n`);
  process.exitCode = 1;
});
