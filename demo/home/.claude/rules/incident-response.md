# Incident Response

- Declare an incident early rather than late; the cost of a false alarm
  that resolves itself in five minutes is a handful of people briefly
  distracted, and the cost of a real incident nobody declared for an hour
  is an hour of unmanaged, uncoordinated, undocumented firefighting.
- One person is the incident commander at any given time, and their job
  is coordination, not debugging — the commander tracks who's doing what,
  keeps a timeline, and decides when to escalate, while the engineers
  actually investigating stay focused on the problem instead of also
  trying to track the state of everyone else's work.
- Write the timeline as the incident happens, not afterward from memory.
  A reconstructed timeline written the next day smooths over exactly the
  confusing, contradictory signals that are usually the most useful part
  of understanding what actually went wrong and why it took as long as
  it did to figure out.
- Mitigate first, root-cause second. Stopping the bleeding — rolling back
  a bad deploy, failing over, shedding load — matters more in the moment
  than understanding exactly why it broke; the full root cause can wait
  for the postmortem, but customer impact can't wait for a satisfying
  explanation.
- Every incident gets a blameless postmortem within a week, focused on
  what the system and the process allowed to happen rather than on who
  did what, because a postmortem people are afraid to contribute to
  honestly produces a sanitized document that prevents nothing the next
  time a similar failure mode shows up.
- Action items from a postmortem get an owner and a deadline, or they
  don't count as action items — a postmortem full of good intentions with
  no owner reliably produces the same incident again in six months, often
  with the same root cause restated nearly word for word.
