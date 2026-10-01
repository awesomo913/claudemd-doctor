/**
 * Claude API pricing table, in USD per million tokens.
 *
 * Verified against Anthropic's published pricing page (not recalled from
 * training data) — see PRICING_SOURCE_URL / PRICING_VERIFIED_DATE below.
 * Re-fetch that page and bump the date before trusting this file again.
 *
 * Per that page: 5-minute cache writes are always 1.25x base input price,
 * and 1-hour cache writes are always 2x base input price, across every
 * model. The cache-READ multiplier varies by model (0.1x for most models,
 * 0.025x for Claude Fable 5.1 / Claude Mythos 5.1, 0.05x for Claude Opus
 * 5.5) — so cacheReadPerMTok is stored explicitly per model rather than
 * derived from a single constant.
 */

export const PRICING_SOURCE_URL = "https://platform.claude.com/docs/en/about-claude/pricing";
export const PRICING_VERIFIED_DATE = "2026-10-01";

export interface ModelPricing {
  /** Canonical model id as it appears in transcripts, e.g. "claude-sonnet-5". */
  id: string;
  /** Short name usable with --model, e.g. "sonnet". */
  alias: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWrite5mPerMTok: number;
  cacheWrite1hPerMTok: number;
  cacheReadPerMTok: number;
  /** Always true in this table — every row was read off the pricing page, never guessed. */
  verified: true;
}

function row(
  id: string,
  alias: string,
  inputPerMTok: number,
  outputPerMTok: number,
  cacheReadMultiplier: number,
): ModelPricing {
  return {
    id,
    alias,
    inputPerMTok,
    outputPerMTok,
    cacheWrite5mPerMTok: inputPerMTok * 1.25,
    cacheWrite1hPerMTok: inputPerMTok * 2,
    cacheReadPerMTok: inputPerMTok * cacheReadMultiplier,
    verified: true,
  };
}

// Table transcribed verbatim from the "Model pricing" table at
// PRICING_SOURCE_URL on PRICING_VERIFIED_DATE. Only models actually seen in
// real transcripts on the dev machine (plus their listed siblings) are
// included; add a row here — citing the same source — before trusting a
// price for a model not in this list.
export const PRICING_TABLE: ModelPricing[] = [
  row("claude-fable-5-1", "fable-5-1", 10.0, 50.0, 0.025),
  row("claude-fable-5", "fable-5", 10.0, 50.0, 0.1),
  row("claude-opus-5-5", "opus-5-5", 4.0, 20.0, 0.05),
  row("claude-opus-5", "opus", 5.0, 25.0, 0.1),
  row("claude-opus-4-8", "opus-4-8", 5.0, 25.0, 0.1),
  row("claude-opus-4-7", "opus-4-7", 5.0, 25.0, 0.1),
  row("claude-opus-4-6", "opus-4-6", 5.0, 25.0, 0.1),
  row("claude-sonnet-5-5", "sonnet-5-5", 2.0, 10.0, 0.1),
  row("claude-sonnet-5", "sonnet", 2.0, 10.0, 0.1),
  row("claude-sonnet-4-6", "sonnet-4-6", 3.0, 15.0, 0.1),
  row("claude-haiku-4-5", "haiku", 1.0, 5.0, 0.1),
];

export const DEFAULT_MODEL_ALIAS = "sonnet";

/**
 * Look up pricing by alias ("sonnet", "opus", "haiku") or by full model id.
 * Transcripts sometimes record a dated snapshot id (e.g.
 * "claude-haiku-4-5-20251001") for a model that's priced identically to its
 * bare id — if an exact match fails, retry with a trailing "-YYYYMMDD"
 * suffix stripped before giving up and returning undefined ("unpriced").
 */
export function getPricing(modelOrAlias: string): ModelPricing | undefined {
  const needle = modelOrAlias.toLowerCase();
  const exact = PRICING_TABLE.find((m) => m.alias === needle || m.id === needle);
  if (exact) return exact;

  const dateSuffixStripped = needle.replace(/-\d{8}$/, "");
  if (dateSuffixStripped !== needle) {
    return PRICING_TABLE.find((m) => m.id === dateSuffixStripped);
  }
  return undefined;
}

export interface CostEstimate {
  uncachedUsd: number;
  cacheReadUsd: number;
}

/** Cost of sending `tokens` input tokens once, with and without a cache hit. */
export function estimateInputCost(tokens: number, pricing: ModelPricing): CostEstimate {
  return {
    uncachedUsd: (tokens / 1_000_000) * pricing.inputPerMTok,
    cacheReadUsd: (tokens / 1_000_000) * pricing.cacheReadPerMTok,
  };
}
