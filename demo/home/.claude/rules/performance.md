# Performance

- Measure before optimizing. A guess about what's slow is wrong often
  enough that profiling first is faster overall than guessing twice.
- Budget page-load and API-response targets per endpoint, and treat a
  regression past that budget the same as a failing test: it blocks the
  release until it's explained or fixed, not silently accepted.
- Cache aggressively at the boundary where data actually changes slowly,
  and invalidate explicitly rather than relying on a short TTL to paper
  over a cache that's wrong more often than it's right.
- Avoid N+1 queries in anything that runs per-request; a loop that issues
  one query per item is fine for ten items and a production incident for
  ten thousand, and the code review should catch it at ten.
- Large list views paginate or virtualize; nothing renders an unbounded
  list directly, no matter how small the dataset looks in the demo
  environment where this problem never shows up.
- Background jobs get a timeout and a retry policy with backoff, so a
  stuck dependency degrades one job instead of filling the whole queue
  with retries that will never succeed.
