# Localization

- User-facing strings never get concatenated from pieces at runtime; a
  sentence built from "The " + count + " items" assumes an English word
  order and an English pluralization rule that most other languages
  don't share, and it breaks in ways that are invisible to anyone who
  only reads the English build.
- Every translatable string goes through the translation key system from
  day one, even before a second language actually ships — retrofitting
  translation onto a codebase that was written assuming one language is
  far more work than writing it translatable the first time, because by
  then the assumption is baked into dozens of call sites instead of one.
- Dates, numbers, and currency render through the locale-aware formatting
  library, never hand-built with string interpolation. A hand-built date
  format that looks right in one locale is routinely ambiguous or simply
  wrong in another, and the bug reports for that kind of mistake tend to
  arrive long after the code that caused them shipped.
- Layouts tolerate text length roughly doubling; a label that fits snugly
  in English frequently doesn't fit at all once translated, and a layout
  that assumes English-length text breaks visibly — truncated buttons,
  overlapping labels — the moment a longer translation ships.
- Right-to-left languages are a layout direction, not a special case
  bolted on afterward; mirroring margins, icons, and flow for RTL late in
  a project touches far more of the codebase than doing it as part of the
  original layout work would have.
- Translators get context, not bare strings — a screenshot or a note
  about where a string appears and who's reading it, because the same
  English word can need a different translation in a button than in a
  paragraph, and a translator working from a spreadsheet of bare strings
  has no way to know which case they're looking at.
