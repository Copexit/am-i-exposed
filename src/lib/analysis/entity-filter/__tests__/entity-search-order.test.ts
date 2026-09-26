import { describe, it, expect } from "vitest";
import entityData from "@/data/entities.json";
import { searchEntitiesByPrefix } from "../entity-search";

const entities = entityData.entities as Array<{
  name: string;
  priority?: number;
  sampleAddresses?: string[];
}>;
const byName = new Map(entities.map((e) => [e.name, e]));

describe("searchEntitiesByPrefix ordering and limits", () => {
  it("orders entities by priority desc, then name asc", () => {
    for (const prefix of ["bi", "co", "ba", "sa"]) {
      const names = [...new Set(searchEntitiesByPrefix(prefix, 200).map((r) => r.entityName))];
      for (let i = 1; i < names.length; i++) {
        const a = byName.get(names[i - 1]!)!;
        const b = byName.get(names[i]!)!;
        const pa = a.priority ?? 3;
        const pb = b.priority ?? 3;
        expect(pa > pb || (pa === pb && a.name.localeCompare(b.name) <= 0)).toBe(true);
      }
    }
  });

  it("returns the entity's first two sample addresses in order", () => {
    const src = byName.get("Binance")!.sampleAddresses!;
    expect(src.length).toBeGreaterThanOrEqual(3);
    const got = searchEntitiesByPrefix("binance", 200).filter((r) => r.entityName === "Binance");
    expect(got.map((r) => r.address)).toEqual(src.slice(0, 2));
  });

  it("returns nothing for a zero or negative limit", () => {
    expect(searchEntitiesByPrefix("bi", 0)).toEqual([]);
    expect(searchEntitiesByPrefix("bi", -1)).toEqual([]);
  });

  it("stops exactly at the limit, even mid-entity", () => {
    expect(searchEntitiesByPrefix("bi", 1)).toHaveLength(1);
    const five = searchEntitiesByPrefix("bi", 5);
    expect(five).toHaveLength(5);
    expect(five).toEqual(searchEntitiesByPrefix("bi", 200).slice(0, 5));
  });

  it("never suggests entities without sample addresses", () => {
    for (const r of searchEntitiesByPrefix("ba", 200).concat(searchEntitiesByPrefix("co", 200))) {
      expect(byName.get(r.entityName)!.sampleAddresses).toContain(r.address);
    }
  });
});
