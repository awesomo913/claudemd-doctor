import { describe, expect, it } from "vitest";
import { formatUsd } from "../src/doctor/render.js";

describe("formatUsd (precision fix: 3 significant figures under $1)", () => {
  it("shows 3 significant figures for small amounts instead of rounding to 2 decimals", () => {
    // The original bug: $0.025768 rendered as "$0.03", losing the figure
    // that actually matters for a sub-cent-per-turn cost.
    expect(formatUsd(0.025768)).toBe("$0.0258");
  });

  it("keeps plain 2-decimal formatting for amounts >= $1", () => {
    expect(formatUsd(1.5)).toBe("$1.50");
    expect(formatUsd(154.608)).toBe("$154.61");
  });

  it("formats exactly zero as $0", () => {
    expect(formatUsd(0)).toBe("$0");
  });

  it("still shows meaningful precision for very small amounts", () => {
    expect(formatUsd(0.00012345)).toBe("$0.000123");
  });
});
