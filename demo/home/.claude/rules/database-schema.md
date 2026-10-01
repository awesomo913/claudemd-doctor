# Database Schema

- Every schema change is a reversible migration, forward and backward,
  checked into the same pull request as the code that needs it; a
  migration without a tested rollback is a one-way door, and one-way
  doors in a production database are exactly the kind of decision that
  deserves more scrutiny than they usually get under deadline pressure.
- Add columns as nullable or with a default, and backfill in a separate
  step from making them required — a single migration that adds a
  required column and expects every existing row to already have a value
  locks the table for the length of the backfill, which on a large table
  can be long enough to be its own incident.
- Foreign keys are enforced at the database level, not just checked in
  application code, because application-level checks only catch
  violations written through that specific application, and a database
  that's ever touched by more than one code path — a script, a second
  service, a manual fix — needs the constraint enforced where it can't
  be bypassed.
- Index the columns that are actually queried, verified against real
  query patterns, not guessed from the schema shape; an index that
  nobody's queries use still costs write performance and storage, and a
  missing index on a column that is queried constantly is one of the
  most common causes of a "sudden" slowdown that was actually building
  for months.
- Soft-delete columns need an explicit policy for what every other query
  in the codebase does about them, or they become invisible rows that
  get silently included in reports and silently excluded from others,
  depending entirely on whether whoever wrote that particular query
  remembered to filter them out.
- Naming conventions for tables and columns are consistent and
  documented once, not re-decided per feature; a schema where half the
  tables use singular names and half use plural, or where some
  timestamps are `_at` and others are `_date`, makes every new query a
  small guessing game about which convention this particular table
  happened to use.
