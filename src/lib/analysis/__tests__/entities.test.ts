import { describe, it, expect } from "vitest";
import { getEntity } from "../entities";

describe("entities", () => {
  it("looks up entity by name (case-insensitive)", () => {
    const binance = getEntity("Binance");
    expect(binance).toBeDefined();
    expect(binance!.category).toBe("exchange");
    expect(binance!.status).toBe("active");

    const lower = getEntity("binance");
    expect(lower).toBeDefined();
    expect(lower!.name).toBe("Binance");
  });

  it("returns undefined for unknown entity", () => {
    expect(getEntity("NonexistentEntity123")).toBeUndefined();
  });
});
