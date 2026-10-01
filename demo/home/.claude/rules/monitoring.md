# Monitoring and Observability

- Every service exports the same baseline metrics — request rate, error
  rate, latency percentiles — under the same names, so a dashboard built
  for one service works for the next one without custom wiring, and an
  on-call engineer unfamiliar with a specific service can still orient
  themselves in seconds instead of hunting for where its metrics live.
- Alerts fire on symptoms a human can act on, not on every metric that
  moves. An alert for "error rate above threshold for five minutes" is
  actionable; an alert for "CPU briefly spiked" usually isn't, and a pager
  that fires on both trains the on-call engineer to ignore it, which is
  the actual failure mode an alerting system exists to prevent.
- Logs are structured, not free-text, so they can be queried by field
  instead of grepped by hope. A log line that's just an interpolated
  string is fine for a human glancing at a terminal and useless for
  anyone trying to build a dashboard or an alert from the same data a
  week later.
- Traces propagate a request ID across every service it touches, so a
  slow or failing request can be followed end to end instead of
  reconstructed by cross-referencing timestamps across five separate log
  streams that each only tell part of the story.
- Dashboards answer a specific question someone actually asks, not
  "everything we could plot." A dashboard with forty panels and no clear
  reading order gets opened once during an incident and then ignored
  because nobody can tell where to look first under pressure.
- Review alert noise on a schedule and delete or retune anything that
  fired and required no action in the last quarter; an alert that's wrong
  often enough stops being read carefully long before anyone gets around
  to actually fixing or removing it.
