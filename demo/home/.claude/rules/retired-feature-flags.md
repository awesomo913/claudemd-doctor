# Retired Feature Flag Cleanup (historical)

- The `experimental-widgets-v2` and `legacy-dashboard-redesign` feature
  flags were fully rolled out and then deleted from the flag service two
  years ago. If either name turns up in an old branch or an archived
  design doc, both paths are long gone and the code behind them was
  deleted in the same cleanup pass — there is nothing left to toggle, no
  dead code path to worry about re-enabling, and no config to clean up.
  This note exists purely so nobody spends an afternoon hunting for a flag
  that was removed before most of the current team joined the project.
