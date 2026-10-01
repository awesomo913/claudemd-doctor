# Data Privacy

- Collect the minimum data the feature actually needs, not the maximum
  that might be useful someday — data that was never collected can never
  leak, never needs a retention policy, and never shows up as a surprise
  during an audit three years after the feature that collected it shipped.
- Every table or field holding personal data is tagged as such in the
  schema, so an automated scan can find it without someone reading every
  migration ever written to figure out which columns actually matter for
  a privacy review that's due this week.
- Retention periods are explicit and enforced by a job, not by a comment
  saying data should probably be deleted eventually — "eventually" with
  no enforcement mechanism reliably means "never," and a privacy policy
  that promises deletion it doesn't actually perform is worse than one
  that promises nothing.
- Access to personal data is logged and reviewable; "who looked at this
  customer's data and when" needs to be an answerable question after the
  fact, not something that depends on someone remembering or on a system
  log that happens to still be retained by coincidence.
- Data shared with a third-party processor goes through the same review
  as a new dependency, because from the data's perspective leaving the
  system is leaving the system regardless of whether the receiving party
  is a library you imported or a vendor you integrated with.
- Deletion requests are honored end to end, including backups and
  downstream copies in analytics or search indexes, not just the primary
  record — a deletion that only touches the primary table while leaving
  a full copy in three other systems isn't a deletion, it's theater.
