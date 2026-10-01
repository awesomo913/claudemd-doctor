import { parseArgs } from "node:util";
import process from "node:process";
import { buildDoctorReport, DEFAULT_MODEL_ALIAS } from "./doctor/report.js";
import { renderJson, renderMarkdown, renderPretty } from "./doctor/render.js";

const HELP = `claudemd-doctor — see what your CLAUDE.md costs you on every single turn.

Usage: claudemd-doctor [options]

Options:
  --cwd <dir>            Analyze this directory instead of the current one
  --json                 Output machine-readable JSON (stable schema)
  --markdown             Output markdown (for pasting into issues/PRs)
  --model <name>         Pricing model: sonnet (default), opus, haiku
  --turns-per-day <n>    Turns/day used for the monthly cost projection (default 200)
  --max-sessions <n>     Newest-N transcript files to scan (default 200)
  --all                  Include transcripts from every project, not just this cwd
  --no-transcripts       Skip the measured-reality / unreferenced-rules scan entirely
  --agents               Also show AGENTS.md (Codex) / GEMINI.md chains for comparison
  --fail-over <tokens>   Exit 1 if the instruction tree exceeds this many ≈tokens
  --all-rules            Pretty/markdown mode: show every unreferenced rule, not just the top 10
  -h, --help             Show this help
`;

interface CliArgs {
  cwd?: string;
  json?: boolean;
  markdown?: boolean;
  model?: string;
  "turns-per-day"?: string;
  "max-sessions"?: string;
  all?: boolean;
  "no-transcripts"?: boolean;
  agents?: boolean;
  "fail-over"?: string;
  "all-rules"?: boolean;
  help?: boolean;
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
        json: { type: "boolean" },
        markdown: { type: "boolean" },
        model: { type: "string" },
        "turns-per-day": { type: "string" },
        "max-sessions": { type: "string" },
        all: { type: "boolean" },
        "no-transcripts": { type: "boolean" },
        agents: { type: "boolean" },
        "fail-over": { type: "string" },
        "all-rules": { type: "boolean" },
        help: { type: "boolean", short: "h" },
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
    onProgress,
  });

  const renderOptions = { showAllRules: Boolean(values["all-rules"]) };

  if (values.json) {
    process.stdout.write(`${renderJson(report)}\n`);
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
