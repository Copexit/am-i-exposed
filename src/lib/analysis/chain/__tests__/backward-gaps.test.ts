import { describe, it, expect, beforeEach } from "vitest";
import { analyzeBackward } from "../backward";
import { makeTx, makeVin, makeVout, makeCoinbaseVin, resetAddrCounter } from "../../heuristics/__tests__/fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

const id = (n: number) => n.toString(16).padStart(64, "0");
const whirlpool = () => makeTx({
  txid: id(1),
  vin: Array.from({ length: 5 }, (_, i) => makeVin({ txid: id(100 + i) })),
  vout: Array.from({ length: 5 }, () => makeVout({ value: 100_000 })),
});
const dustParent = () => makeTx({
  txid: id(2),
  vin: [makeVin()],
  vout: Array.from({ length: 12 }, () => makeVout({ value: 546 })),
});
const inputOf = (value: number) => makeVin({
  txid: id(2),
  prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qdusted", value },
});

describe("analyzeBackward - gaps", () => {
  it("reports partial CoinJoin provenance with a reduced bonus", () => {
    const tx = makeTx({ vin: [makeVin({ txid: id(1) }), makeVin({ txid: id(3) })] });
    const { findings, coinJoinInputs } = analyzeBackward(tx, new Map([[0, whirlpool()], [1, makeTx({ txid: id(3) })]]));
    expect(coinJoinInputs).toEqual([0]);
    const f = findings.find((x) => x.id === "chain-coinjoin-input");
    expect(f?.title).toBe("1/2 inputs came from CoinJoin");
    expect(f?.scoreImpact).toBe(3);
    expect(f?.params).toEqual({ coinJoinCount: 1, totalInputs: 2 });
  });

  it("flags a dust input at exactly the dust threshold", () => {
    const tx = makeTx({ vin: [inputOf(1000)] });
    const r = analyzeBackward(tx, new Map([[0, dustParent()]]));
    expect(r.dustInputs).toEqual([0]);
    expect(r.findings.find((x) => x.id === "chain-dust-input")?.scoreImpact).toBe(-10);
  });

  it("does not flag an input above the dust threshold from a dusting parent", () => {
    const tx = makeTx({ vin: [inputOf(1001)] });
    expect(analyzeBackward(tx, new Map([[0, dustParent()]])).dustInputs).toEqual([]);
  });

  it("does not flag a dusting parent whose outputs reuse addresses", () => {
    const reused = makeTx({ txid: id(2), vin: [makeVin()], vout: Array.from({ length: 12 }, () => makeVout({ value: 546, scriptpubkey_address: "bc1qsame" })) });
    const tx = makeTx({ vin: [inputOf(546)] });
    expect(analyzeBackward(tx, new Map([[0, reused]])).dustInputs).toEqual([]);
  });

  it("ignores coinbase inputs and out-of-range indices", () => {
    const tx = makeTx({ vin: [makeCoinbaseVin()] });
    const r = analyzeBackward(tx, new Map([[0, whirlpool()], [5, whirlpool()]]));
    expect(r.findings).toEqual([]);
    expect(r.coinJoinInputs).toEqual([]);
  });

  it("requires mixed script types for an exchange batch", () => {
    const uniform = makeTx({ vin: [makeVin()], vout: Array.from({ length: 12 }, () => makeVout()) });
    const tx = makeTx({ vin: [makeVin()] });
    expect(analyzeBackward(tx, new Map([[0, uniform]])).exchangeInputs).toEqual([]);
  });
});
