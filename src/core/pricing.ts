/**
 * Claude API pricing table, in USD per million tokens.
 *
 * Source: Anthropic's published Messages API pricing. "Last verified"
 * records when these numbers were last checked against Anthropic's docs —
 * re-check and bump that date before trusting this file for real invoices.
 *
 * Cache pricing follows Anthropic's standard ratios relative to the base
 * input price: a 5-minute ephemeral cache write costs 1.25x base input, and
 * a cache read costs 0.1x base input. Output tokens are never cached.
 */

export const PRICING_LAST_VERIFIED = "2026-06-24";

export interface ModelPricing {
  /** Canonical model id, e.g. "claude-sonnet-5". */
  id: string;
  /** Short name usable with --model, e.g. "sonnet". */
  alias: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
}

function derive(id: string, alias: string, inputPerMTok: number, outputPerMTok: number): ModelPricing {
  return {
    id,
    alias,
    inputPerMTok,
    outputPerMTok,
    cacheWritePerMTok: inputPerMTok * 1.25,
    cacheReadPerMTok: inputPerMTok * 0.1,
  };
}

export const PRICING_TABLE: ModelPricing[] = [
  derive("claude-opus-5", "opus", 5.0, 25.0),
  derive("claude-sonnet-5", "sonnet", 2.0, 10.0),
  derive("claude-haiku-4-5", "haiku", 1.0, 5.0),
];

export const DEFAULT_MODEL_ALIAS = "sonnet";

/** Look up pricing by alias ("sonnet", "opus", "haiku") or by full model id. */
export function getPricing(modelOrAlias: string): ModelPricing | undefined {
  const needle = modelOrAlias.toLowerCase();
  return PRICING_TABLE.find((m) => m.alias === needle || m.id === needle);
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
