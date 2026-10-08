import { describe, it, expect } from "vitest";
import { amtInRange, parseObsHash, serializeObsHash, type ObsState } from "../obs-hash";

const TABS = ["wabisabi", "whirlpool", "p2p"] as const;
const P2P = { cur: null, side: "buy", venue: ["robosats", "mostro", "hodlhodl"], pm: null, amt: null, amtu: "fiat" } as const;
const tx = "ab".repeat(32);

describe("obs hash", () => {
  it("round-trips", () => {
    const states: ObsState[] = [
      { tab: "wabisabi", period: 7, coordinator: "kruw", tx, view: "table", ...P2P, venue: [...P2P.venue] },
      { tab: "whirlpool", period: 1, coordinator: null, tx: null, view: "map", ...P2P, venue: [...P2P.venue] },
      { tab: "wabisabi", period: 30, coordinator: "coinjoin_nl", tx: null, view: "map", ...P2P, venue: [...P2P.venue] },
      { tab: "p2p", period: 1, coordinator: "temple", tx: null, view: "table", cur: "EUR", side: "sell", venue: ["mostro", "hodlhodl"], pm: "revolut", amt: 250, amtu: "fiat" },
      { tab: "p2p", period: 1, coordinator: null, tx: null, view: "map", ...P2P, venue: [...P2P.venue], amt: 0.00001234, amtu: "btc" },
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
  it("pm: canonical ids round-trip, unknown ids are ignored", () => {
    expect(serializeObsHash(parseObsHash("#p2p&cur=EUR&pm=sepa-instant", TABS))).toBe("#p2p&cur=EUR&pm=sepa-instant");
    expect(parseObsHash("#p2p&pm=other", TABS).pm).toBe("other");
    for (const junk of ["nope", "Revolut", "__proto__", "%E0%A4%A", ""]) expect(parseObsHash(`#p2p&pm=${junk}`, TABS).pm).toBeNull();
  });
  it("amt: plain decimals round-trip with their unit, junk and out-of-range values are dropped", () => {
    expect(serializeObsHash(parseObsHash("#p2p&cur=EUR&amt=250&amtu=fiat", TABS))).toBe("#p2p&cur=EUR&amt=250&amtu=fiat");
    expect(serializeObsHash(parseObsHash("#p2p&amt=0.0034&amtu=btc", TABS))).toBe("#p2p&amt=0.0034&amtu=btc");
    expect(parseObsHash("#p2p&amt=12.5", TABS)).toMatchObject({ amt: 12.5, amtu: "fiat" });
    expect(serializeObsHash({ ...parseObsHash("#p2p", TABS), amt: 1e-8, amtu: "btc" })).toBe("#p2p&amt=0.00000001&amtu=btc");
    expect(serializeObsHash({ ...parseObsHash("#p2p", TABS), amt: 249.999, amtu: "fiat" })).toBe("#p2p&amt=250&amtu=fiat");
    for (const junk of ["0", "-5", "1e5", "1,5", "abc", "0x10", "Infinity", "NaN", " 5", "1.123456789", "%E0%A4%A", "", "99999999999999"]) {
      expect(parseObsHash(`#p2p&amt=${junk}`, TABS).amt).toBeNull();
    }
    expect(parseObsHash("#p2p&amt=1000000000000", TABS).amt).toBe(1e12);
    expect(parseObsHash("#p2p&amt=21000001&amtu=btc", TABS).amt).toBeNull();
    // Below one cent or one sat: never written as amt=0, never read back.
    expect(parseObsHash("#p2p&amt=0.001", TABS).amt).toBeNull();
    expect(parseObsHash("#p2p&amt=0.01", TABS).amt).toBe(0.01);
    expect(parseObsHash("#p2p&amt=0.000000009&amtu=btc", TABS).amt).toBeNull();
    expect(parseObsHash("#p2p&amt=0.00000001&amtu=btc", TABS).amt).toBe(1e-8);
    expect(amtInRange(0.004, "fiat")).toBeNull();
    expect(amtInRange(5e-9, "btc")).toBeNull();
    expect(amtInRange(1e12 + 1, "fiat")).toBeNull();
    expect(parseObsHash("#p2p&amt=5&amtu=sats", TABS).amtu).toBe("fiat");
  });
});
