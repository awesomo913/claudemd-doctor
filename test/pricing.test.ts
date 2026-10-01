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

  it("derives cache pricing as a fixed ratio of base input price", () => {
    for (const m of PRICING_TABLE) {
      expect(m.cacheWritePerMTok).toBeCloseTo(m.inputPerMTok * 1.25, 6);
      expect(m.cacheReadPerMTok).toBeCloseTo(m.inputPerMTok * 0.1, 6);
    }
  });

  it("computes cost math correctly for a known token count", () => {
    const pricing = getPricing("sonnet");
    if (!pricing) throw new Error("sonnet pricing missing");
    const cost = estimateInputCost(1_000_000, pricing);
    expect(cost.uncachedUsd).toBeCloseTo(pricing.inputPerMTok, 6);
    expect(cost.cacheReadUsd).toBeCloseTo(pricing.cacheReadPerMTok, 6);
  });
});
