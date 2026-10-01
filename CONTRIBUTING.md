# Contributing

Thanks for looking at `claudemd-doctor`. It's a small, single-purpose CLI —
contributions are welcome, but keep the scope tight.

## Setup

```bash
git clone https://github.com/awesomo913/claudemd-doctor.git
cd claudemd-doctor
npm install
npm run build
npm test
```

## Before opening a pull request

- `npm run typecheck` — must pass with no errors.
- `npm test` — must pass. Add tests for new behavior; see `test/` for the
  existing patterns (synthetic fixtures only — see Privacy below).
- `npm run build` — confirm the CLI still builds and runs
  (`node dist/cli.js --help`).
- Keep changes focused. If you're fixing two unrelated things, open two
  pull requests.

## Privacy

Fixtures and tests must use synthetic data only. Never commit real
transcript content, a real `CLAUDE.md`, real usernames, or real file paths
from your own machine — see `demo/` for the pattern this project uses
(a fully synthetic `~/.claude` under `--home`).

## Project layout

- `src/core/` — reusable, no CLI imports (transcripts, tokens, pricing, paths).
- `src/doctor/` — the actual report logic (discovery, rules, conflicts,
  analysis, rendering).
- `src/cli.ts` — argument parsing and glue.
- `test/` — vitest, with fixtures under `test/fixtures/`.
- `demo/` — the synthetic fixture `npm run demo` runs against.

## Reporting a bug

Please include your OS, Node version, and (if you can) the `--json` output
with any real file paths redacted. See [SECURITY.md](SECURITY.md) for
reporting a security issue privately instead of as a public issue.

## License

By contributing, you agree your contribution is licensed under this
project's [MIT license](LICENSE).
