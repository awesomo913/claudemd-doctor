# Error Handling

- Handle errors explicitly; never leave an empty catch block.
- User-facing messages stay friendly and short; detailed context goes to the logs.
- Validate all external input at system boundaries before it reaches business logic.
- Re-throw with added context instead of swallowing an error silently.
- Distinguish between retryable errors (network, rate limit) and permanent ones (bad input, auth).
