import { describe, it, expect, beforeEach } from "vitest";
import { analyzeBackwardTaint } from "../taint";
import type { TraceLayer } from "../recursive-trace";
import type { MempoolTransaction, MempoolVin } from "@/lib/api/types";
import {
  makeTx, makeVin, makeVout, makeCoinbaseVin, makeOpReturnVout, resetAddrCounter,
} from "../../heuristics/__tests__/fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

const ENTITIES: Record<string, { category: string; entityName: string }> = {
  bc1qexchange: { category: "exchange", entityName: "Binance" },
  bc1qexchange2: { category: "exchange", entityName: "Kraken" },
  bc1qpool: { category: "mining", entityName: "F2Pool" },
  bc1qmarket: { category: "darknet", entityName: "Hydra" },
};
const checker = (addr: string) => ENTITIES[addr] ?? null;

const id = (n: number) => n.toString(16).padStart(64, "0");

function vinFrom(address: string, value: number, txid = id(999)): MempoolVin {
  return makeVin({
    txid,
    prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: address, value },
  });
}

function layers(...txs: MempoolTransaction[]): TraceLayer[] {
  return [{ depth: 1, txs: new Map(txs.map((t) => [t.txid, t])) }];
}

describe("analyzeBackwardTaint", () => {
  it("returns nothing when there are no backward layers (even with direct entity inputs)", () => {
    const tx = makeTx({ vin: [vinFrom("bc1qexchange", 100_000)] });
    const r = analyzeBackwardTaint(tx, [], checker);
    expect(r.findings).toEqual([]);
    expect(r.outputTaint.size).toBe(0);
    expect(r.inputSources.size).toBe(0);
  });

  it("weights a direct (hop 0) entity input by its share of input value", () => {
    // 30k exchange + 70k unknown = 30% taint; fee does not change the fraction
    const tx = makeTx({
      vin: [vinFrom("bc1qexchange", 30_000), vinFrom("bc1qunknown", 70_000)],
      vout: [makeVout({ value: 60_000 }), makeVout({ value: 38_000 }), makeOpReturnVout()],
      fee: 2_000,
    });
    const r = analyzeBackwardTaint(tx, layers(), checker);

    expect(r.inputSources.get(0)).toEqual([{ category: "exchange", entityName: "Binance", fraction: 0.3, hops: 0 }]);
    expect(r.inputSources.has(1)).toBe(false);

    // Proportional: every spendable output inherits the same 30% taint; OP_RETURN skipped
    expect([...r.outputTaint.keys()]).toEqual([0, 1]);
    expect(r.outputTaint.get(0)?.total).toBeCloseTo(0.3, 10);
    expect(r.outputTaint.get(1)?.sources.get("exchange")).toBeCloseTo(0.3, 10);

    expect(r.findings).toHaveLength(1);
    const f = r.findings[0]!;
    expect(f.id).toBe("chain-taint-backward");
    // Direct entity inputs are scored by entity-detection, not again here
    expect(f.scoreImpact).toBe(0);
    expect(f.severity).toBe("low");
    expect(f.title).toBe("30% of input value traceable to known entities");
    expect(f.description).toContain("30% exchange");
    expect(f.recommendation).toMatch(/^Some funds are traceable/);
    expect(f.params).toEqual({ taintPct: 30, sourceCount: 1, sourceCategories: "exchange" });
  });

  it("propagates one-hop parent taint with the haircut method", () => {
    // Parent P: 60k from mining pool + 40k unknown => 60% mining taint.
    // tx: 50k from P (not an entity address) + 50k unknown (no parent) => 0.6 * 0.5 = 30%
    const parent = makeTx({
      txid: id(1),
      vin: [vinFrom("bc1qpool", 60_000), vinFrom("bc1qnobody", 40_000)],
    });
    const tx = makeTx({
      vin: [vinFrom("bc1qmine", 50_000, parent.txid), vinFrom("bc1qother", 50_000, id(2))],
    });
    const r = analyzeBackwardTaint(tx, layers(parent), checker);

    const src = r.inputSources.get(0);
    expect(src).toHaveLength(1);
    expect(src?.[0]?.category).toBe("mining");
    expect(src?.[0]?.hops).toBe(1);
    expect(src?.[0]?.entityName).toBeUndefined();
    expect(src?.[0]?.fraction).toBeCloseTo(0.3, 10);
    expect(r.findings[0]?.params?.taintPct).toBe(30);
    expect(r.findings[0]?.scoreImpact).toBe(-3);
  });

  it("does not double count: a direct match skips the parent lookup", () => {
    const parent = makeTx({ txid: id(3), vin: [vinFrom("bc1qexchange", 100_000)] });
    const tx = makeTx({ vin: [vinFrom("bc1qexchange", 100_000, parent.txid)] });
    const r = analyzeBackwardTaint(tx, layers(parent), checker);
    expect(r.inputSources.get(0)).toEqual([{ category: "exchange", entityName: "Binance", fraction: 1, hops: 0 }]);
    expect(r.outputTaint.get(0)?.total).toBe(1);
    const f = r.findings[0]!;
    // All taint is hop 0: severity follows the (zero) scored parent taint
    expect(f.severity).toBe("low");
    expect(f.scoreImpact).toBe(0);
    expect(f.recommendation).toMatch(/^A majority of funds/);
  });

  it("aggregates categories across inputs and hops, sorted by share", () => {
    // in0 60k direct darknet, in1 40k via parent that is 50% exchange / 50% exchange2 (both exchange)
    const parent = makeTx({
      txid: id(4),
      vin: [vinFrom("bc1qexchange", 10_000), vinFrom("bc1qexchange2", 10_000)],
    });
    const tx = makeTx({
      vin: [vinFrom("bc1qmarket", 60_000), vinFrom("bc1qx", 40_000, parent.txid)],
    });
    const r = analyzeBackwardTaint(tx, layers(parent), checker);
    const sources = r.outputTaint.get(0)?.sources;
    expect(sources?.get("darknet")).toBeCloseTo(0.6, 10);
    expect(sources?.get("exchange")).toBeCloseTo(0.4, 10);
    expect(r.outputTaint.get(0)?.total).toBeCloseTo(1, 10);
    expect(r.findings[0]?.description).toContain("60% darknet, 40% exchange");
    expect(r.findings[0]?.params?.sourceCount).toBe(2);
    // Only the 40% reached through the parent is scored
    expect(r.findings[0]?.scoreImpact).toBe(-3);
  });

  it("uses low severity below 30% taint", () => {
    const tx = makeTx({ vin: [vinFrom("bc1qpool", 10_000), vinFrom("bc1qz", 90_000)] });
    const f = analyzeBackwardTaint(tx, layers(), checker).findings[0];
    expect(f?.severity).toBe("low");
    expect(f?.scoreImpact).toBe(0);
    expect(f?.params?.taintPct).toBe(10);
  });

  it("treats exactly 80% parent taint as high severity", () => {
    const parent = makeTx({ txid: id(5), vin: [vinFrom("bc1qpool", 80_000), vinFrom("bc1qz", 20_000)] });
    const tx = makeTx({ vin: [vinFrom("bc1qme", 100_000, parent.txid)] });
    const f = analyzeBackwardTaint(tx, layers(parent), checker).findings[0];
    expect(f?.severity).toBe("high");
    expect(f?.scoreImpact).toBe(-5);
    expect(f?.params?.taintPct).toBe(80);
  });

  it("only input-address (hop 0) taint: no score impact and low severity", () => {
    const tx = makeTx({ vin: [vinFrom("bc1qpool", 80_000), vinFrom("bc1qz", 20_000)] });
    const f = analyzeBackwardTaint(tx, layers(), checker).findings[0];
    expect(f?.scoreImpact).toBe(0);
    expect(f?.severity).toBe("low");
    expect(f?.params?.taintPct).toBe(80);
  });

  it("ignores inputs with missing prevouts when weighting", () => {
    // Only the 50k known input counts; it is fully exchange => 100%
    const missing = makeVin({ txid: id(5), prevout: null });
    const tx = makeTx({ vin: [vinFrom("bc1qexchange", 50_000), missing] });
    const r = analyzeBackwardTaint(tx, layers(), checker);
    expect(r.inputSources.get(0)?.[0]?.fraction).toBe(1);
    expect(r.inputSources.has(1)).toBe(false);
    expect(r.findings[0]?.params?.taintPct).toBe(100);
  });

  it("returns empty for a coinbase transaction (no input value)", () => {
    const tx = makeTx({ vin: [makeCoinbaseVin()] });
    const r = analyzeBackwardTaint(tx, layers(), checker);
    expect(r.findings).toEqual([]);
    expect(r.outputTaint.size).toBe(0);
  });

  it("yields no parent taint when the parent is a coinbase", () => {
    const cb = makeTx({ txid: id(6), vin: [makeCoinbaseVin()] });
    const tx = makeTx({ vin: [vinFrom("bc1qminer", 100_000, cb.txid)] });
    const r = analyzeBackwardTaint(tx, layers(cb), checker);
    expect(r.findings).toEqual([]);
    expect(r.inputSources.size).toBe(0);
  });

  it("only looks one hop back: a grandparent entity does not taint", () => {
    const grand = makeTx({ txid: id(7), vin: [vinFrom("bc1qexchange", 100_000)] });
    const parent = makeTx({ txid: id(8), vin: [vinFrom("bc1qclean", 100_000, grand.txid)] });
    const tx = makeTx({ vin: [vinFrom("bc1qme", 100_000, parent.txid)] });
    const deep: TraceLayer[] = [
      { depth: 1, txs: new Map([[parent.txid, parent]]) },
      { depth: 2, txs: new Map([[grand.txid, grand]]) },
    ];
    expect(analyzeBackwardTaint(tx, deep, checker).findings).toEqual([]);
  });

  it("finds a parent placed in any layer (lookup is by txid, not depth)", () => {
    const parent = makeTx({ txid: id(9), vin: [vinFrom("bc1qpool", 100_000)] });
    const tx = makeTx({ vin: [vinFrom("bc1qme", 100_000, parent.txid)] });
    const r = analyzeBackwardTaint(tx, [
      { depth: 1, txs: new Map() },
      { depth: 2, txs: new Map([[parent.txid, parent]]) },
    ], checker);
    expect(r.findings[0]?.params?.taintPct).toBe(100);
  });

  it("weights a self-referencing parent once (one hop only)", () => {
    // Malformed trace where the parent claims to spend itself: taint is still one hop
    const loop = makeTx({ txid: id(10), vin: [vinFrom("bc1qpool", 50_000, id(10)), vinFrom("bc1qa", 50_000, id(10))] });
    const tx = makeTx({ vin: [vinFrom("bc1qme", 100_000, loop.txid)] });
    const r = analyzeBackwardTaint(tx, layers(loop), checker);
    expect(r.findings[0]?.params?.taintPct).toBe(50);
  });

  it("produces no output taint when all outputs are OP_RETURN", () => {
    const tx = makeTx({ vin: [vinFrom("bc1qexchange", 100_000)], vout: [makeOpReturnVout()] });
    const r = analyzeBackwardTaint(tx, layers(), checker);
    expect(r.outputTaint.size).toBe(0);
    expect(r.findings).toHaveLength(1);
  });
});
