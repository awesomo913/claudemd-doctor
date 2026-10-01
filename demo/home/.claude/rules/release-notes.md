# Release Notes

- Every release gets a changelog entry written for the person using the
  product, not a copy of commit messages pasted in order — "fixed a bug
  in the parser" tells a user nothing about whether it affects them, and
  "fixed a crash when pasting multi-line text" tells them exactly whether
  to care.
- Group changes by user impact (new, fixed, changed, removed), not by
  which team or service happened to ship them — the reader cares what
  changed for them, not which part of the org produced the change, and
  organizing by team makes the reader do the translation work themselves.
- Breaking changes get their own clearly marked section at the top, not
  buried alphabetically with everything else, because the reader scanning
  a changelog before upgrading is specifically looking for exactly that
  section first and shouldn't have to read the whole thing to find it.
- Link each entry to the relevant documentation or migration guide when
  one exists, so a reader who's affected can go straight to the fix
  instead of filing a support ticket asking how to adapt to a change the
  changelog already described.
- Draft the changelog alongside the work, not in a rush right before the
  release ships — a changelog written from memory after the fact
  routinely misses the smaller changes that a reader might actually care
  about, because the person writing it has already mentally moved on to
  what's next.
- Keep a consistent tone and tense across entries; a changelog that
  reads like it was written by five different people in five different
  styles is harder to scan quickly, even when every individual entry is
  accurate and clearly written on its own.
