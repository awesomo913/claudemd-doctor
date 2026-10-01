# Retired API Migration Notes (v1 -> v2, completed, kept for history)

- When the internal API moved from `/api/v1/` to `/api/v2/` three years ago,
  every client needed to add the `X-Api-Version: 2` header, switch from the
  deprecated `widgetId` field to the new `widget_id` field, handle the new
  paginated response shape with `next_cursor` instead of `page`, and run the
  provided `migrate-v1-calls.py` script against any saved request fixtures.
  This migration finished long ago and nothing in the current codebase
  still speaks v1, but the notes stay here because the one remaining
  partner integration occasionally resurfaces questions about the old
  response shape, and it's faster to point them at this file than to
  reconstruct the answer from memory every time.
