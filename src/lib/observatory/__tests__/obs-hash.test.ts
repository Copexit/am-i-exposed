import { describe, it, expect } from "vitest";
import { parseObsHash, serializeObsHash, type ObsState } from "../obs-hash";

const TABS = ["wabisabi", "whirlpool", "p2p"] as const;
const P2P = { cur: null, side: "buy", venue: ["robosats", "mostro", "hodlhodl"] } as const;
const tx = "ab".repeat(32);

describe("obs hash", () => {
  it("round-trips", () => {
    const states: ObsState[] = [
      { tab: "wabisabi", period: 7, coordinator: "kruw", tx, view: "table", ...P2P, venue: [...P2P.venue] },
      { tab: "whirlpool", period: 1, coordinator: null, tx: null, view: "map", ...P2P, venue: [...P2P.venue] },
      { tab: "wabisabi", period: 30, coordinator: "coinjoin_nl", tx: null, view: "map", ...P2P, venue: [...P2P.venue] },
      { tab: "p2p", period: 1, coordinator: "temple", tx: null, view: "table", cur: "EUR", side: "sell", venue: ["mostro", "hodlhodl"] },
    ];
    for (const s of states) expect(parseObsHash(serializeObsHash(s), TABS)).toEqual(s);
  });
  it("omits defaults", () => {
    expect(serializeObsHash({ tab: "wabisabi", period: 7, coordinator: "kruw", tx: null, view: "map" })).toBe("#wabisabi&period=7&coordinator=kruw");
    expect(serializeObsHash({ tab: "wabisabi", period: 1, coordinator: null, tx: null, view: "map" })).toBe("#wabisabi");
  });
  it("tolerates junk without throwing", () => {
    expect(parseObsHash("#wabisabi&coordinator=nope&tx=zz", TABS)).toMatchObject({ tab: "wabisabi", period: 1, coordinator: "nope", tx: null, view: "map" });
    expect(parseObsHash("#mystery&period=5&view=grid&coordinator=%E0%A4%A", TABS)).toMatchObject({ tab: "wabisabi", period: 1, view: "map" });
    expect(parseObsHash("", TABS).tab).toBe("wabisabi");
    expect(parseObsHash(`#whirlpool&tx=${tx.toUpperCase()}`, TABS)).toMatchObject({ tab: "whirlpool", tx });
  });
  it("P2P keys: round-trip, defaults omitted, junk falls back", () => {
    const h = "#p2p&cur=EUR&side=sell&venue=mostro,hodlhodl";
    expect(serializeObsHash(parseObsHash(h, TABS))).toBe(h);
    expect(parseObsHash("#p2p&cur=zz1&side=nope&venue=evil", TABS)).toMatchObject({ tab: "p2p", cur: null, side: "buy", venue: ["robosats", "mostro", "hodlhodl"] });
    expect(parseObsHash("#p2p&cur=brl", TABS).cur).toBe("BRL");
    expect(serializeObsHash({ ...parseObsHash("#p2p&venue=hodlhodl,robosats,mostro", TABS) })).toBe("#p2p");
  });
});
