# API Design

- Design the API around what callers need to express, not around the
  internal data model that happens to be convenient to serialize today —
  the internal model will change for reasons that have nothing to do with
  the API contract, and a leaky API design makes every one of those
  internal changes a potential breaking change for every caller.
- Every breaking change ships behind a new version, never as a silent
  change to an existing one. "Nobody should be relying on that edge
  case" is a guess, and guesses about who depends on what are wrong often
  enough, across enough callers, that versioning discipline is cheaper
  than finding out the hard way which guess was wrong this time.
- Error responses carry a stable machine-readable code in addition to a
  human-readable message, because the message is for a person reading
  logs and the code is for a program deciding whether to retry, and
  changing the wording of the message should never change what a caller's
  retry logic decides to do.
- Pagination is cursor-based for anything that can grow without bound;
  offset-based pagination silently skips or repeats items when the
  underlying data changes between pages, and that failure mode is
  invisible until someone's report quietly drops rows for weeks before
  anyone notices the numbers don't add up.
- Idempotency keys are required on every endpoint that creates something,
  so a client retry after a timeout can't accidentally create the same
  thing twice — a client that got a timeout genuinely doesn't know
  whether the request succeeded, and the API needs to make retrying safe
  rather than asking every caller to solve that problem themselves.
- Deprecate loudly and on a schedule: an announcement, a response header
  on every call to the deprecated endpoint, and a hard removal date
  communicated well in advance — a deprecation nobody hears about isn't a
  deprecation, it's a surprise outage with a delay timer on it.
