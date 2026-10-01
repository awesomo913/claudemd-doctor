# Design System

- New UI work pulls components from the shared design system before
  building a one-off; a one-off component that looks close enough today
  becomes a second, slightly different pattern that both designers and
  engineers have to remember exists the next time something similar
  needs to be built somewhere else in the product.
- A component only earns a place in the shared system after it's been
  used in at least two real features, not designed speculatively for a
  future that might need it. Speculative components tend to guess wrong
  about what the second real use case actually needs and get reworked
  anyway once it shows up.
- Design tokens (color, spacing, type scale) are the single source of
  truth for both the design file and the code; a token changed in one
  place and not the other is exactly the kind of drift that makes a
  product feel inconsistent in ways that are hard to point to directly
  but easy to feel.
- Every component ships with its accessible states (focus, disabled,
  error) defined from the start, not added later as a follow-up. A
  follow-up accessibility pass on a component already used in twenty
  places costs far more than designing the states in alongside the
  default appearance the first time.
- Breaking changes to a shared component go through a deprecation period
  with both the old and new version available, the same discipline as a
  breaking API change, because a shared component has callers across the
  whole product who didn't ask for this specific release to change their
  screen's behavior.
- The design system's own documentation site is the source of truth for
  usage guidance, not a design file that most engineers don't have open
  while they're writing code — if the guidance only lives somewhere
  engineers don't look, the guidance might as well not exist for the
  decisions that actually get made during implementation.
