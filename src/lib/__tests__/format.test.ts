import { describe, it, expect } from "vitest";
import { formatSats } from "../format";

describe("formatSats", () => {
  it("formats basic amounts", () => {
    expect(formatSats(1000)).toBe("1,000 sats");
    expect(formatSats(0)).toBe("0 sats");
  });

  it("formats large amounts with locale separators", () => {
    expect(formatSats(100_000_000)).toBe("100,000,000 sats");
  });

  it("handles negative values", () => {
    expect(formatSats(-500)).toBe("-500 sats");
  });
});
