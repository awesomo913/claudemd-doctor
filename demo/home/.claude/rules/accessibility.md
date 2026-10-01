# Accessibility

- Every interactive element is reachable by keyboard alone; if a mouse is
  required to use a feature, the feature isn't done yet.
- Images need real alt text describing their content, not the filename
  and not a generic placeholder like "image" — a screen reader user
  should get the same information a sighted user gets at a glance.
- Color is never the only signal for state (error, success, required);
  pair it with text, an icon, or both, since color-blind users and
  high-contrast-mode users both lose color-only signals in different ways.
- Form fields have a visible, programmatically-associated label; a
  placeholder is not a label, and it disappears the moment someone starts
  typing, which is exactly when they need it most.
- Focus order follows visual order; a tab sequence that jumps around the
  page is disorienting for keyboard and screen-reader users even when
  sighted mouse users never notice the problem exists.
- Run the automated accessibility checker before every release, and treat
  a new violation the same as a new failing test, not a follow-up ticket
  that's easy to deprioritize once the release ships.
