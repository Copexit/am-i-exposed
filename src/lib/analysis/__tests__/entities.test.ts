import { describe, it, expect } from "vitest";
import {
  getEntity,
  getEntitiesByCategory,
  getOfacEntities,
  ENTITY_COUNT,
  getCategoryCounts,
} from "../entities";

describe("entities", () => {
  it("has 150+ entities", () => {
    expect(ENTITY_COUNT).toBeGreaterThanOrEqual(150);
  });

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

  it("filters by category", () => {
    const exchanges = getEntitiesByCategory("exchange");
    expect(exchanges.length).toBeGreaterThanOrEqual(50);
    expect(exchanges.every((e) => e.category === "exchange")).toBe(true);

    const mining = getEntitiesByCategory("mining");
    expect(mining.length).toBeGreaterThanOrEqual(5);
  });

  it("returns OFAC-sanctioned entities", () => {
    const ofac = getOfacEntities();
    expect(ofac.length).toBeGreaterThanOrEqual(8);
    expect(ofac.every((e) => e.ofac === true)).toBe(true);

    // Known OFAC entities
    const names = ofac.map((e) => e.name);
    expect(names).toContain("Hydra");
    expect(names).toContain("Garantex");
    expect(names).toContain("Chipmixer");
    expect(names).toContain("Tornado Cash");
  });

  it("has all expected categories", () => {
    const counts = getCategoryCounts();
    expect(counts.exchange).toBeGreaterThan(0);
    expect(counts.darknet).toBeGreaterThan(0);
    expect(counts.scam).toBeGreaterThan(0);
    expect(counts.gambling).toBeGreaterThan(0);
    expect(counts.payment).toBeGreaterThan(0);
    expect(counts.mining).toBeGreaterThan(0);
    expect(counts.mixer).toBeGreaterThan(0);
    expect(counts.p2p).toBeGreaterThan(0);
  });
});
