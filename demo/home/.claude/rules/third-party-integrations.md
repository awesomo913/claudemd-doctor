# Third-Party Integrations

- Every external API call goes through a thin wrapper, never called
  directly from feature code, so a vendor's breaking change or an
  eventual vendor switch touches one file instead of every call site
  scattered across the codebase that happened to need that integration.
- Set a timeout on every external call, shorter than the user's patience
  for the feature it supports; a third-party dependency with no timeout
  can turn a five-second feature into a five-minute hang the one day
  their service is slow, and the user has no way to know it isn't your
  own system that's broken.
- Treat a third-party outage as a certainty on a long enough timeline,
  not an edge case — build the degraded experience (cached data, a
  clear error, a retry with backoff) before it's needed, not during the
  incident when the vendor's status page is the only source of truth
  anyone has.
- Webhook handlers verify the signature on every request and are
  idempotent, since most providers retry on anything other than a clean
  success response; a handler that isn't idempotent will eventually
  double-process a webhook delivery, usually during exactly the kind of
  transient network blip that triggers the provider's retry in the first
  place.
