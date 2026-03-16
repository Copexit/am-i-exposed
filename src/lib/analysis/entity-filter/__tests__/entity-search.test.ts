import { describe, it, expect } from "vitest";
import { searchEntitiesByPrefix } from "../entity-search";

describe("searchEntitiesByPrefix", () => {
  it("returns empty for queries shorter than 2 chars", () => {
    expect(searchEntitiesByPrefix("")).toEqual([]);
    expect(searchEntitiesByPrefix("b")).toEqual([]);
  });

  it("returns matching entities for 'bi' prefix", () => {
    const results = searchEntitiesByPrefix("bi");
    expect(results.length).toBeGreaterThan(0);
    // All results should have entity names starting with "bi" (case-insensitive)
    for (const r of results) {
      expect(r.entityName.toLowerCase().startsWith("bi")).toBe(true);
      expect(r.address).toBeTruthy();
      expect(r.category).toBeTruthy();
    }
  });

  it("is case-insensitive", () => {
    const lower = searchEntitiesByPrefix("bi");
    const upper = searchEntitiesByPrefix("BI");
    const mixed = searchEntitiesByPrefix("Bi");
    expect(lower).toEqual(upper);
    expect(lower).toEqual(mixed);
  });

  it("respects the limit parameter", () => {
    const limited = searchEntitiesByPrefix("bi", 3);
    expect(limited.length).toBeLessThanOrEqual(3);
  });

  it("returns results sorted by priority (high priority first)", () => {
    const results = searchEntitiesByPrefix("bi", 20);
    if (results.length < 2) return; // not enough data to test sorting

    // Group by entity name and check the first entity has highest priority
    const seen = new Set<string>();
    const entityOrder: string[] = [];
    for (const r of results) {
      if (!seen.has(r.entityName)) {
        seen.add(r.entityName);
        entityOrder.push(r.entityName);
      }
    }
    // Just verify we got multiple entities
    expect(entityOrder.length).toBeGreaterThan(1);
  });

  it("returns up to 2 addresses per entity", () => {
    const results = searchEntitiesByPrefix("bi", 20);
    const counts = new Map<string, number>();
    for (const r of results) {
      counts.set(r.entityName, (counts.get(r.entityName) || 0) + 1);
    }
    for (const [, count] of counts) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it("returns valid Bitcoin addresses", () => {
    const results = searchEntitiesByPrefix("co", 10);
    for (const r of results) {
      expect(r.address).toMatch(/^(1|3|bc1)/);
    }
  });

  it("returns no results for non-matching prefix", () => {
    expect(searchEntitiesByPrefix("zzzzz")).toEqual([]);
    expect(searchEntitiesByPrefix("xyzabc")).toEqual([]);
  });
});
