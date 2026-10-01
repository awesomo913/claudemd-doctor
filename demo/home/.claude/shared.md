# Shared Team Conventions

- Never use `npm` in this repo — always use `pnpm install` instead. The
  lockfile was migrated to pnpm last quarter and `npm` will desync it
  silently without raising an error.
- Tag the relevant reviewers on anything touching the public API surface.
- Squash merge every pull request; never use a regular merge commit.
- Delete the feature branch after merging — don't leave stale branches around.
- New environment variables need a one-line description in `.env.example`.
- Bump the package version in `package.json` for every release, following semver.
