# Security

- Never commit secrets, API keys, or credentials — use environment variables instead.
- Validate every external input at the boundary before it reaches business logic.
- Keep dependencies patched; review the changelog before taking a major version bump.
- Log security-relevant events (auth failures, permission denials) with enough context to investigate later.
- Treat all user-supplied file paths as untrusted; never build a path by naive string concatenation.
