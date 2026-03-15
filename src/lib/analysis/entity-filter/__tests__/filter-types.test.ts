import { describe, it, expect } from "vitest";
import type { AddressFilter, FilterMeta, EntityMatch, FilterStatus } from "../types";

describe("entity filter types", () => {
  it("AddressFilter interface works with Set backend", () => {
    const addresses = new Set(["bc1qtest1", "bc1qtest2"]);
    const meta: FilterMeta = {
      buildDate: "2025-01-01",
      addressCount: 2,
      version: 1,
      fpr: 0,
    };
    const filter: AddressFilter = {
      has: (addr) => addresses.has(addr),
      meta,
    };

    expect(filter.has("bc1qtest1")).toBe(true);
    expect(filter.has("bc1qunknown")).toBe(false);
    expect(filter.meta.addressCount).toBe(2);
    expect(filter.meta.fpr).toBe(0);
  });

  it("EntityMatch has required fields", () => {
    const match: EntityMatch = {
      address: "bc1qtest",
      entityName: "Test Exchange",
      category: "exchange",
      ofac: false,
      confidence: "medium",
    };
    expect(match.confidence).toBe("medium");
    expect(match.category).toBe("exchange");
  });

  it("FilterStatus covers all states", () => {
    const states: FilterStatus[] = ["idle", "loading", "ready", "error", "unavailable"];
    expect(states).toHaveLength(5);
  });
});
