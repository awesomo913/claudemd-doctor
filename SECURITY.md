# Security Policy

`claudemd-doctor` runs entirely locally: it reads files already on your
machine (your `CLAUDE.md` chain and your own Claude Code transcript
history) and never makes a network request. There's no server, no
telemetry, and no account.

## Reporting a vulnerability

If you find a security issue (for example, a way a crafted `CLAUDE.md` or
transcript file could cause unintended file access, code execution, or a
path-traversal read outside the intended directories), please report it
privately rather than opening a public issue:

- Use GitHub's [private vulnerability reporting](https://github.com/awesomo913/claudemd-doctor/security/advisories/new)
  for this repository, or
- Open an issue asking for a private contact if that's not available to you.

Please include the version (`claudemd-doctor --version`), your OS, and
clear reproduction steps. We'll acknowledge reports within a few days.

## Supported versions

Only the latest published version on npm is supported. There is no
long-term-support branch at this stage.
