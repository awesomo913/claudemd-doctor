# Code Review Depth

- Read the whole diff before commenting, not just the first file that
  loads — a comment on line one made before seeing line two hundred
  sometimes contradicts something the author already addressed further
  down, and that back-and-forth costs more review rounds than reading
  the whole thing first would have.
- Distinguish blocking comments from suggestions explicitly; a reviewer
  who leaves ten comments without marking any of them as optional leaves
  the author guessing which ones actually need to be addressed before
  merge and which ones are just the reviewer thinking out loud.
- Run the code locally for anything risky or hard to evaluate by reading
  alone — a review based purely on reading the diff catches a different,
  narrower set of problems than a review that also exercises the change,
  and the two together catch more than either one does on its own.
- Approve what's actually in the pull request, not what the author says
  it does in the description; a description that doesn't match the diff
  is itself worth a comment, because it usually means either the
  description is stale or the diff did something unintended.
- A large pull request is itself a review comment — ask for it to be
  split before diving into line-by-line feedback on a five-thousand-line
  diff, because thorough review of a change that size is close to
  impossible regardless of how much time the reviewer spends on it.
- Review turnaround matters as much as review depth; a perfect review
  that arrives three days later blocks the author for three days, and a
  good-enough review that arrives in an hour with a quick follow-up often
  serves the team better than waiting for the first reviewer to find
  time for a completely thorough pass.
