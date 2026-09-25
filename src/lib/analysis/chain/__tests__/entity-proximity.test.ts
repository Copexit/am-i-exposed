import { describe, it, expect, beforeEach, vi } from "vitest";

const KNOWN: Record<string, { name: string | null; category: string | null }> = {
  bc1qbinance: { name: "Binance", category: "exchange" },
  bc1qhydra: { name: "Hydra", category: "darknet" },
  bc1qnocat: { name: "Binance", category: null },
  bc1qbloomonly: { name: null, category: null },
};

vi.mock("../../entity-filter/filter-loader", () => ({
  getFilter: vi.fn(),
  lookupEntityName: vi.fn((a: string) => KNOWN[a]?.name ?? null),
  lookupEntityCategory: vi.fn((a: string) => KNOWN[a]?.category ?? null),
}));

import { analyzeEntityProximity } from "../entity-proximity";
import { getFilter } from "../../entity-filter/filter-loader";
import type { TraceLayer } from "../recursive-trace";
import type { MempoolTransaction } from "@/lib/api/types";
import { makeTx, makeVin, makeVout, makeOpReturnVout, resetAddrCounter } from "../../heuristics/__tests__/fixtures/tx-factory";

const mockGetFilter = vi.mocked(getFilter);
const filter = { meta: { fpr: 0.001, addressCount: 4, version: 1, buildDate: "" }, has: (a: string) => a in KNOWN };

beforeEach(() => {
  resetAddrCounter();
  mockGetFilter.mockReturnValue(filter);
});

const id = (n: number) => n.toString(16).padStart(64, "0");
const target = makeTx({ txid: id(0) });

function inputFrom(address: string, txid: number): MempoolTransaction {
  return makeTx({
    txid: id(txid),
    vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: address, value: 1 } })],
  });
}
function outputTo(address: string, txid: number): MempoolTransaction {
  return makeTx({ txid: id(txid), vout: [makeOpReturnVout(), makeVout({ scriptpubkey_address: address })] });
}
function whirlpool(txid: number): MempoolTransaction {
  return makeTx({
    txid: id(txid),
    vin: Array.from({ length: 5 }, (_, i) => makeVin({ txid: id(1000 + txid * 10 + i) })),
    vout: Array.from({ length: 5 }, () => makeVout({ value: 100_000 })),
  });
}
const plain = (txid: number) => makeTx({ txid: id(txid) });

/** Build layers where layers[i] has depth i+1. */
function chain(...perDepth: MempoolTransaction[][]): TraceLayer[] {
  return perDepth.map((txs, i) => ({ depth: i + 1, txs: new Map(txs.map((t) => [t.txid, t])) }));
}

describe("analyzeEntityProximity", () => {
  it("returns nothing for clean layers", () => {
    const r = analyzeEntityProximity(target, chain([plain(1)]), chain([plain(2)]));
    expect(r.findings).toEqual([]);
    expect(r.nearestBackward).toBeNull();
    expect(r.coinJoinInAncestry).toBe(false);
  });

  it("reports a direct 1-hop backward exchange as high/-4", () => {
    const r = analyzeEntityProximity(target, chain([inputFrom("bc1qbinance", 1)]), []);
    expect(r.nearestBackward).toEqual({
      entityName: "Binance", category: "exchange", address: "bc1qbinance", hops: 1, txid: id(1), direction: "backward",
    });
    const f = r.findings[0]!;
    expect(f.id).toBe("chain-entity-proximity-backward");
    expect(f.severity).toBe("high");
    expect(f.scoreImpact).toBe(-4);
    expect(f.title).toBe("1 hop from Binance (exchange)");
    expect(f.description).toContain("Direct connection");
    expect(f.description).not.toContain("OFAC");
  });

  it("uses the nearest layer and scales severity with distance", () => {
    const back = chain([plain(1)], [outputTo("bc1qbinance", 2)], [inputFrom("bc1qhydra", 3)]);
    const r = analyzeEntityProximity(target, back, []);
    expect(r.nearestBackward?.hops).toBe(2);
    expect(r.nearestBackward?.entityName).toBe("Binance");
    expect(r.findings[0]?.severity).toBe("medium");
    expect(r.findings[0]?.scoreImpact).toBe(-2);
    expect(r.findings[0]?.title).toBe("2 hops from Binance (exchange)");
  });

  it("scores 3+ hops as low/-1", () => {
    const r = analyzeEntityProximity(target, chain([plain(1)], [plain(2)], [inputFrom("bc1qbinance", 3)]), []);
    expect(r.findings[0]?.severity).toBe("low");
    expect(r.findings[0]?.scoreImpact).toBe(-1);
  });

  it("skips unnamed Bloom-only matches and defaults a missing category to unknown", () => {
    const r = analyzeEntityProximity(target, chain([inputFrom("bc1qbloomonly", 1)], [inputFrom("bc1qnocat", 2)]), []);
    expect(r.nearestBackward?.hops).toBe(2);
    expect(r.nearestBackward?.category).toBe("unknown");
  });

  it("does not scan addresses when no filter is loaded but still detects CoinJoin ancestry", () => {
    mockGetFilter.mockReturnValue(null);
    const r = analyzeEntityProximity(target, chain([whirlpool(1)], [inputFrom("bc1qbinance", 2)]), []);
    expect(r.nearestBackward).toBeNull();
    expect(r.coinJoinInAncestry).toBe(true);
    expect(r.findings.map((f) => f.id)).toEqual(["chain-coinjoin-ancestry"]);
    expect(r.findings[0]?.scoreImpact).toBe(5);
  });

  describe("OFAC entities", () => {
    it.each([
      [1, "critical", -10],
      [2, "high", -5],
      [3, "medium", -2],
    ] as const)("at %i hops is %s/%i", (hops, severity, impact) => {
      const layers = chain(...Array.from({ length: hops }, (_, i) => (i === hops - 1 ? [inputFrom("bc1qhydra", 10 + i)] : [plain(10 + i)])));
      const f = analyzeEntityProximity(target, layers, []).findings[0];
      expect(f?.severity).toBe(severity);
      expect(f?.scoreImpact).toBe(impact);
      expect(f?.description).toContain("OFAC sanctions list");
    });

    it("is never suppressed by a CoinJoin barrier", () => {
      const r = analyzeEntityProximity(target, chain([whirlpool(1)], [whirlpool(2)], [inputFrom("bc1qhydra", 3)]), []);
      const f = r.findings.find((x) => x.id === "chain-entity-proximity-backward");
      expect(f?.params?.cjBarrier).toBeUndefined();
      expect(f?.scoreImpact).toBe(-2);
    });
  });

  describe("CoinJoin barrier", () => {
    it("suppresses when 1 CoinJoin sits before an entity 3+ hops away", () => {
      const r = analyzeEntityProximity(target, chain([whirlpool(1)], [plain(2)], [inputFrom("bc1qbinance", 3)]), []);
      const f = r.findings.find((x) => x.id === "chain-entity-proximity-backward");
      expect(f?.scoreImpact).toBe(0);
      expect(f?.severity).toBe("low");
      expect(f?.params?.cjBarrier).toBe(1);
      expect(f?.title).toBe("Binance detected 3 hops back (behind CoinJoin)");
    });

    it("does not suppress with 1 CoinJoin when the entity is 2 hops away", () => {
      const r = analyzeEntityProximity(target, chain([whirlpool(1)], [inputFrom("bc1qbinance", 2)]), []);
      const f = r.findings.find((x) => x.id === "chain-entity-proximity-backward");
      expect(f?.scoreImpact).toBe(-2);
      expect(f?.params?.cjBarrier).toBeUndefined();
    });

    it("does not count a CoinJoin at the same depth as the entity", () => {
      const r = analyzeEntityProximity(target, chain([plain(1)], [plain(2)], [whirlpool(3), inputFrom("bc1qbinance", 4)]), []);
      const f = r.findings.find((x) => x.id === "chain-entity-proximity-backward");
      expect(f?.scoreImpact).toBe(-1);
    });

    it("suppresses a forward entity behind 2 CoinJoin rounds", () => {
      const r = analyzeEntityProximity(target, [], chain([whirlpool(1)], [whirlpool(2)], [outputTo("bc1qbinance", 3)]));
      const f = r.findings.find((x) => x.id === "chain-entity-proximity-forward");
      expect(f?.scoreImpact).toBe(0);
      expect(f?.params?.cjBarrier).toBe(2);
      expect(f?.description).toContain("2 CoinJoin rounds");
      expect(r.coinJoinInDescendancy).toBe(true);
      expect(r.findings.find((x) => x.id === "chain-coinjoin-descendancy")?.scoreImpact).toBe(3);
    });
  });

  it("does not re-report the analyzed tx's own addresses (entity-detection scores those)", () => {
    const own = makeTx({
      txid: id(0),
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qbinance", value: 1 } })],
      vout: [makeVout({ scriptpubkey_address: "bc1qhydra" })],
    });
    const r = analyzeEntityProximity(own, chain([outputTo("bc1qbinance", 1)]), chain([inputFrom("bc1qhydra", 2)]));
    expect(r.nearestBackward).toBeNull();
    expect(r.nearestForward).toBeNull();
    expect(r.findings).toEqual([]);
  });

  it("reports a direct forward deposit", () => {
    const r = analyzeEntityProximity(target, [], chain([outputTo("bc1qbinance", 1)]));
    const f = r.findings[0]!;
    expect(f.id).toBe("chain-entity-proximity-forward");
    expect(f.title).toBe("Funds reach Binance in 1 hop");
    expect(f.scoreImpact).toBe(-4);
    expect(f.params).toMatchObject({ direction: "forward", entityTxid: id(1), entityAddress: "bc1qbinance", hops: 1 });
    expect(r.nearestBackward).toBeNull();
  });
});
