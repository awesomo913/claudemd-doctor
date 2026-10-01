import { describe, expect, it } from "vitest";
import { countTokens } from "../src/core/tokens.js";
import { estimateInputCost, getPricing, PRICING_TABLE } from "../src/core/pricing.js";

describe("countTokens", () => {
  it("returns 0 for empty text", () => {
    expect(countTokens("")).toBe(0);
  });

  it("returns a positive count for normal text, roughly proportional to length", () => {
    const short = countTokens("hello world");
    const long = countTokens("hello world ".repeat(50));
    expect(short).toBeGreaterThan(0);
    expect(long).toBeGreaterThan(short * 10);
  });
});

describe("pricing", () => {
  it("resolves models by alias and by full id", () => {
    expect(getPricing("sonnet")?.id).toBe("claude-sonnet-5");
    expect(getPricing("claude-sonnet-5")?.alias).toBe("sonnet");
    expect(getPricing("not-a-model")).toBeUndefined();
  });

  it("derives 5m/1h cache-write pricing as a fixed ratio of base input price for every model", () => {
    // Per Anthropic's pricing page: 5m write = 1.25x input, 1h write = 2x
    // input, for every model — only the cache-READ multiplier varies.
    for (const m of PRICING_TABLE) {
      expect(m.cacheWrite5mPerMTok).toBeCloseTo(m.inputPerMTok * 1.25, 6);
      expect(m.cacheWrite1hPerMTok).toBeCloseTo(m.inputPerMTok * 2, 6);
    }
  });

  it("uses the verified per-model cache-read multiplier (0.025x / 0.05x / 0.1x)", () => {
    const fable51 = getPricing("claude-fable-5-1");
    const opus55 = getPricing("opus-5-5");
    const sonnet = getPricing("sonnet");
    if (!fable51 || !opus55 || !sonnet) throw new Error("expected pricing rows missing");
    expect(fable51.cacheReadPerMTok).toBeCloseTo(fable51.inputPerMTok * 0.025, 6);
    expect(opus55.cacheReadPerMTok).toBeCloseTo(opus55.inputPerMTok * 0.05, 6);
    expect(sonnet.cacheReadPerMTok).toBeCloseTo(sonnet.inputPerMTok * 0.1, 6);
  });

  it("resolves a dated model snapshot id by stripping the trailing date suffix", () => {
    const dated = getPricing("claude-haiku-4-5-20251001");
    const bare = getPricing("claude-haiku-4-5");
    expect(dated).toBeDefined();
    expect(dated?.id).toBe(bare?.id);
  });

  it("returns undefined (never a silent guess) for an unknown model id", () => {
    expect(getPricing("claude-made-up-9000")).toBeUndefined();
  });

  it("computes cost math correctly for a known token count", () => {
    const pricing = getPricing("sonnet");
    if (!pricing) throw new Error("sonnet pricing missing");
    const cost = estimateInputCost(1_000_000, pricing);
    expect(cost.uncachedUsd).toBeCloseTo(pricing.inputPerMTok, 6);
    expect(cost.cacheReadUsd).toBeCloseTo(pricing.cacheReadPerMTok, 6);
  });
});
