import { describe, it, expect } from "vitest";
import { isRoundAmount } from "../round-amount";

describe("isRoundAmount - round BTC denominations", () => {
  it.each([
    100_000, 200_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000,
    20_000_000, 25_000_000, 50_000_000, 100_000_000, 200_000_000, 500_000_000, 1_000_000_000,
  ])("treats %i sats as round", (sats) => {
    expect(isRoundAmount(sats)).toBe(true);
  });

  it("does not treat sub-10k or odd values as round", () => {
    expect(isRoundAmount(5_000)).toBe(false);
    expect(isRoundAmount(123_456)).toBe(false);
  });
});
