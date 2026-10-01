# Feature Flags (active)

- New risky changes ship behind a flag, defaulted off, and get enabled
  gradually rather than all at once — a flag that goes straight to 100%
  the moment it merges gives up the entire point of having a flag, which
  is the ability to limit the blast radius while still watching real
  traffic hit the new path.
- Flags get a removal date at creation time, not just a creation date; a
  flag that's been at 100% for six months with no plan to delete it is
  dead code wearing a costume, and it keeps costing a branch in every
  future change to that area until someone finally removes it.
- Flag names describe the behavior they gate, not the ticket that created
  them — a flag named after a ticket number is unreadable to everyone six
  months later who doesn't remember what that ticket was about, while a
  descriptive name still makes sense on its own.
