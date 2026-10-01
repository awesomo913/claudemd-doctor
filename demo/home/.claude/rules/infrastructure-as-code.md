# Infrastructure as Code

- Every piece of infrastructure is defined in checked-in configuration,
  never created by hand through a console. A resource created by hand is
  invisible to the next person who reads the configuration, invisible to
  the plan that's supposed to describe the whole environment, and the
  first thing to silently diverge the next time someone applies a change.
- Changes to shared infrastructure go through the same review process as
  application code, with a plan or diff attached to the pull request
  showing exactly what will change before it's applied, not just a
  description of the intent that the actual change might not match.
- Environments are defined from the same templates with different
  parameters, not as separate hand-maintained copies that drift apart —
  "staging looks basically like production" stops being true within
  months of two environments being maintained as independent copies
  instead of two instantiations of the same template.
- Secrets never live in the configuration repository, encrypted or not;
  they come from a dedicated secrets manager referenced by name, so
  rotating a credential doesn't require a commit and a leaked repository
  clone doesn't include anything that still works.
- Destructive changes — anything that deletes or replaces a stateful
  resource — require an explicit second confirmation in the pipeline,
  separate from the normal apply step, because the ten extra seconds
  that confirmation costs is cheap compared to an accidentally deleted
  production database.
- Drift between the declared configuration and the actual running state
  gets detected on a schedule and surfaced, not discovered the next time
  someone happens to run a plan and is surprised by a long diff they
  didn't expect to see.
