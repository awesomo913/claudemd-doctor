# Deployment

- Every deploy goes through the CI pipeline; there is no manual deploy path
  for the current services, and any request to add one should be treated
  as a sign that something upstream needs fixing instead.
- Staging deploys happen automatically on every merge to `main`. Production
  deploys require a manual approval step in the pipeline, which any team
  member with write access can grant after checking the staging smoke
  tests passed and the changelog for the release looks right.
- Roll back by redeploying the previous tagged release, never by reverting
  commits under time pressure — a clean revert can wait until the incident
  is over, but a bad rollback compounds the original problem.
- Database migrations run as a separate step before the application
  deploy, and every migration needs a tested rollback path before it
  merges, not just a forward path. A migration without a rollback plan is
  treated the same as a deploy without a rollback plan.
- Feature flags gate anything that changes user-visible behavior, so a bad
  release can be turned off without a redeploy. New flags get documented
  in the flag service's description field, not just in the pull request.
- Canary releases run for at least thirty minutes on a small percentage of
  traffic before a full rollout, and the on-call engineer watches the
  error-rate dashboard during that window rather than starting the rollout
  and walking away.
