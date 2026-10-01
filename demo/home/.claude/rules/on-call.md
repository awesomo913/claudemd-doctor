# On-Call

- The on-call rotation is published at least a month ahead, and swaps go
  through a visible request, not a quiet side-channel message — a swap
  nobody else can see means two people can both think they're off that
  week, and the gap only becomes visible when something's already paging.
- Every alert that pages someone links to a runbook, or it gets fixed to
  link to one before the next on-call shift starts; an alert that just
  says something is wrong with no next step turns a two-minute response
  into a twenty-minute investigation from first principles at three in
  the morning.
- Handoffs between on-call shifts are a real conversation, not a silent
  rotation in the scheduling tool — the outgoing person flags anything
  still warm, anything that might flare back up, and anything odd they
  noticed but didn't have time to chase down fully.
- Compensate on-call time explicitly, whether as pay or time off, and
  track how often a given rotation actually pages overnight; a rotation
  that pages every night isn't sustainable no matter how well-compensated
  it is, and the fix is reducing the paging, not just paying more for it.
- A page that didn't need a response gets looked at afterward, not just
  acknowledged and dismissed — either the alert threshold is wrong or
  there's a real intermittent problem hiding behind "it resolved itself,"
  and both of those are worth five minutes to understand which one it was.
- New team members shadow on-call before they're on the rotation solo,
  watching at least one real page end to end, because reading a runbook
  and actually working a live page under time pressure are different
  skills, and the gap between them is exactly where a first solo shift
  goes badly.
