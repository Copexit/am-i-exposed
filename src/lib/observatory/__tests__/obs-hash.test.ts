import { describe, it, expect } from "vitest";
import { parseObsHash, serializeObsHash, type ObsState } from "../obs-hash";

const TABS = ["wabisabi", "whirlpool"] as const;
const tx = "ab".repeat(32);

describe("obs hash", () => {
  it("round-trips", () => {
    const states: ObsState[] = [
      { tab: "wabisabi", period: 7, coordinator: "kruw", tx, view: "table" },
      { tab: "whirlpool", period: 1, coordinator: null, tx: null, view: "map" },
      { tab: "wabisabi", period: 30, coordinator: "coinjoin_nl", tx: null, view: "map" },
    ];
    for (const s of states) expect(parseObsHash(serializeObsHash(s), TABS)).toEqual(s);
  });
  it("omits defaults", () => {
    expect(serializeObsHash({ tab: "wabisabi", period: 7, coordinator: "kruw", tx: null, view: "map" })).toBe("#wabisabi&period=7&coordinator=kruw");
    expect(serializeObsHash({ tab: "wabisabi", period: 1, coordinator: null, tx: null, view: "map" })).toBe("#wabisabi");
  });
  it("tolerates junk without throwing", () => {
    expect(parseObsHash("#wabisabi&coordinator=nope&tx=zz", TABS)).toEqual({ tab: "wabisabi", period: 1, coordinator: "nope", tx: null, view: "map" });
    expect(parseObsHash("#mystery&period=5&view=grid&coordinator=%E0%A4%A", TABS)).toMatchObject({ tab: "wabisabi", period: 1, view: "map" });
    expect(parseObsHash("", TABS).tab).toBe("wabisabi");
    expect(parseObsHash(`#whirlpool&tx=${tx.toUpperCase()}`, TABS)).toMatchObject({ tab: "whirlpool", tx });
  });
});
