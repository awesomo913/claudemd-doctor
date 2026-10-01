# Mobile Builds

- App store review time is not a release-day planning variable; submit
  with margin for at least one rejection and a fix cycle, because a
  release plan that assumes first-try approval turns a routine update
  into a scramble the one time review flags something minor.
- Crash reporting is wired up before the first release, not added after
  the first wave of one-star reviews mentioning crashes nobody can
  reproduce from a bug report alone — by the time reviews mention it, the
  crash has already cost real users and real ratings.
- Test on the oldest officially supported OS version on real hardware,
  not just the simulator on the newest one; performance and memory
  behavior on older devices diverges from the simulator in ways that
  only show up under real constraints.
