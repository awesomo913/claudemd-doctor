# Dependency Management

- Adding a new dependency is a real decision, not a reflex. Before adding
  one, check whether the standard library or an existing dependency
  already covers most of the need, because every added dependency is a
  permanent line item in the security review, the update cadence, and the
  bundle size, long after whoever added it has moved on to other work.
- Pin exact versions in the lockfile and let a scheduled job open update
  pull requests, rather than letting ranges resolve to whatever the
  registry serves on a given day — a build that passed yesterday and
  fails today because a transitive dependency silently changed behavior
  is one of the most confusing failure modes to debug from scratch.
- Review the changelog, not just the version number, before accepting a
  major-version bump. "No breaking changes we noticed" is not the same
  claim as "we read the changelog and confirmed nothing we use changed",
  and only the second one is actually a review.
- Prefer dependencies with a visible maintenance signal — recent commits,
  responsive issue triage, more than one maintainer — over ones that
  technically still work but haven't been touched in years; "it still
  works" and "it will still work when we need a fix" are different
  properties, and only one of them is visible from the npm page today.
- Audit the full dependency tree on a schedule, not just when a security
  advisory happens to land in an inbox. Advisories catch known problems
  in packages people are watching; an audit catches the ones nobody's
  watching yet, which is most of the tree for most projects.
- Vendor or fork a dependency only as a last resort, and document the
  reason prominently at the top of the vendored copy, because a silent
  fork is invisible to every future update process and will quietly drift
  from upstream security fixes until someone notices the hard way.
