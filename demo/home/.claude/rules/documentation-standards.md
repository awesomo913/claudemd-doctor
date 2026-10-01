# Documentation Standards

- Every public function gets a doc comment describing what it does, what
  it returns, and any non-obvious preconditions — not a restatement of
  the function name in sentence form, which adds a sentence without
  adding any information a reader didn't already have from the signature.
- README files answer three questions in order: what this is, how to run
  it, and how to run the tests. Everything else — architecture notes,
  design rationale, historical context — belongs in a separate docs
  folder that the README links to, so a new contributor's first five
  minutes aren't spent scrolling past material they don't need yet.
- Code examples in documentation are tested, either by a doctest-style
  mechanism or by a script that extracts and runs them; an example that
  silently stopped compiling six months ago is worse than no example,
  because it actively teaches the wrong thing with the appearance of
  authority a working example would have.
- Architecture decision records are short, dated, and immutable once
  merged — if a decision changes, write a new record that references and
  supersedes the old one instead of editing history. Future readers need
  to see not just what was decided but what was tried before and why it
  didn't work, and editing the old record erases that trail.
- API documentation is generated from the same type definitions and
  schemas the code actually uses, never hand-maintained in parallel,
  because hand-maintained API docs drift from the real behavior within
  weeks and nobody notices until a consumer files a confused bug report
  that turns out to be the documentation's fault, not the code's.
- Diagrams live as checked-in source (a diagramming-as-code format) next
  to the document that references them, not as a one-off export pasted
  into a wiki page that nobody can regenerate when the underlying system
  changes shape again, which it inevitably will within a year or two.
- Every runbook includes the specific commands to run, not just a
  description of what should happen, and gets exercised at least once by
  someone other than its author before being trusted in an actual
  incident, because the gap between "this should work" and "this works"
  is exactly where runbooks fail under pressure.
