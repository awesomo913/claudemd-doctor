# Testing

- New code needs at least one happy-path test and one failure-case test.
- Run the full suite with `npm run build` and `npm test` before merging.
- Mock external network calls in unit tests; never hit a real API in CI.
- Flaky tests get a tracking ticket and a `// flaky:` comment, not a silent retry loop.
