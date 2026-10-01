/**
 * Offline token estimation. We use js-tiktoken's o200k_base encoding (the
 * encoding OpenAI's GPT-4o family uses) as a stand-in estimator. Anthropic
 * does not publish an offline tokenizer, and Claude's real tokenizer differs
 * from o200k_base — treat every count from this module as an approximation,
 * documented to be within roughly +/-15% of Claude's actual token count for
 * normal English/code text. Callers should label figures with "≈".
 */
import { getEncoding, type Tiktoken } from "js-tiktoken";

let cachedEncoding: Tiktoken | undefined;

function getEncoder(): Tiktoken {
  cachedEncoding ??= getEncoding("o200k_base");
  return cachedEncoding;
}

/** Estimate the token count of `text` using the offline o200k_base encoder. */
export function countTokens(text: string): number {
  if (text.length === 0) return 0;
  try {
    return getEncoder().encode(text).length;
  } catch {
    // Fall back to a crude 4-chars-per-token heuristic if the encoder
    // itself throws on pathological input (e.g. unpaired surrogates).
    // Never silently report 0 for non-empty text.
    return Math.ceil(text.length / 4);
  }
}

/**
 * Interface for a future exact-count mode backed by Anthropic's
 * `count_tokens` API. Not implemented in v0.1 — `estimate` is the only
 * strategy wired up today, but call sites should depend on this interface
 * rather than `countTokens` directly so a real `--exact` mode can be added
 * later without touching every caller.
 */
export interface TokenCounter {
  readonly kind: "estimate" | "exact";
  count(text: string): number;
}

export const estimateTokenCounter: TokenCounter = {
  kind: "estimate",
  count: countTokens,
};
