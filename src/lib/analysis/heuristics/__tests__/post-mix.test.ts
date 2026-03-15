import { describe, it, expect } from "vitest";
import { analyzePostMix } from "../post-mix";
import {
  makeTx,
  makeVin,
  makeVout,
} from "./fixtures/tx-factory";

function makeVinObj(txid: string, vout: number, addr: string, value: number) {
  return makeVin({
    txid,
    vout,
    prevout: {
      scriptpubkey: "0014aa",
      scriptpubkey_asm: "",
      scriptpubkey_type: "v0_p2wpkh",
      scriptpubkey_address: addr,
      value,
    },
  });
}

function makeVoutObj(addr: string, value: number) {
  return makeVout({
    scriptpubkey: "0014aa",
    scriptpubkey_asm: "",
    scriptpubkey_type: "v0_p2wpkh",
    scriptpubkey_address: addr,
    value,
  });
}

// Helper: build a CoinJoin-like parent with 5+ equal outputs (Whirlpool style)
function makeWhirlpoolParent(txid: string): MempoolTransaction {
  const denom = 5_000_000; // 0.05 BTC pool
  return makeTx({
    txid,
    vin: Array.from({ length: 5 }, (_, i) =>
      makeVinObj(`parent-of-${txid}-${i}`, 0, `bc1qaddr${txid}${i}`, denom + 1000 + i * 100),
    ),
    vout: Array.from({ length: 5 }, (_, i) =>
      makeVoutObj(`bc1qout${txid}${i}`, denom),
    ),
  });
}

describe("analyzePostMix", () => {
  it("should not flag single-input transactions", () => {
    const tx = makeTx({
      vin: [makeVinObj("parent1", 0, "bc1qaddr1", 1_000_000)],
      vout: [makeVoutObj("bc1qout1", 999_000)],
    });

    const { findings } = analyzePostMix(tx);
    expect(findings).toHaveLength(0);
  });

  it("should not flag when no parent txs provided", () => {
    const tx = makeTx({
      vin: [
        makeVinObj("parent1", 0, "bc1qa", 500_000),
        makeVinObj("parent2", 0, "bc1qb", 500_000),
      ],
      vout: [makeVoutObj("bc1qc", 999_000)],
    });

    const { findings } = analyzePostMix(tx, undefined, {});
    expect(findings).toHaveLength(0);
  });

  it("should detect post-mix consolidation from 2 different CoinJoin parents", () => {
    const parent1 = makeWhirlpoolParent("cj1");
    const parent2 = makeWhirlpoolParent("cj2");

    const tx = makeTx({
      vin: [
        makeVinObj("cj1", 0, "bc1qa", 5_000_000),
        makeVinObj("cj2", 1, "bc1qb", 5_000_000),
      ],
      vout: [makeVoutObj("bc1qc", 9_999_000)],
    });

    const { findings } = analyzePostMix(tx, undefined, {
      parentTxs: new Map([["cj1", parent1], ["cj2", parent2]]),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("post-mix-consolidation");
    expect(findings[0].severity).toBe("high");
    expect(findings[0].params?.postMixInputCount).toBe(2);
    expect(findings[0].params?.distinctCoinJoins).toBe(2);
  });

  it("should flag as critical for 3+ post-mix inputs", () => {
    const parent1 = makeWhirlpoolParent("cj1");
    const parent2 = makeWhirlpoolParent("cj2");
    const parent3 = makeWhirlpoolParent("cj3");

    const tx = makeTx({
      vin: [
        makeVinObj("cj1", 0, "bc1qa", 5_000_000),
        makeVinObj("cj2", 1, "bc1qb", 5_000_000),
        makeVinObj("cj3", 2, "bc1qcc", 5_000_000),
      ],
      vout: [makeVoutObj("bc1qd", 14_999_000)],
    });

    const { findings } = analyzePostMix(tx, undefined, {
      parentTxs: new Map([["cj1", parent1], ["cj2", parent2], ["cj3", parent3]]),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].scoreImpact).toBe(-18);
    expect(findings[0].params?.postMixInputCount).toBe(3);
  });

  it("should not flag when inputs are NOT from CoinJoin parents", () => {
    // Regular (non-CoinJoin) parent transactions
    const normalParent1 = makeTx({
      txid: "norm1",
      vin: [makeVinObj("x", 0, "bc1qa", 10_000_000)],
      vout: [
        makeVoutObj("bc1qc", 5_000_000),
        makeVoutObj("bc1qd", 4_999_000),
      ],
    });

    const normalParent2 = makeTx({
      txid: "norm2",
      vin: [makeVinObj("y", 0, "bc1qb", 8_000_000)],
      vout: [
        makeVoutObj("bc1qe", 4_000_000),
        makeVoutObj("bc1qf", 3_999_000),
      ],
    });

    const tx = makeTx({
      vin: [
        makeVinObj("norm1", 0, "bc1qa", 5_000_000),
        makeVinObj("norm2", 0, "bc1qb", 4_000_000),
      ],
      vout: [makeVoutObj("bc1qc", 8_999_000)],
    });

    const { findings } = analyzePostMix(tx, undefined, {
      parentTxs: new Map([["norm1", normalParent1], ["norm2", normalParent2]]),
    });

    expect(findings).toHaveLength(0);
  });

  it("should NOT flag when the transaction itself is a CoinJoin (remixing)", () => {
    const parent1 = makeWhirlpoolParent("cj1");
    const parent2 = makeWhirlpoolParent("cj2");
    const denom = 5_000_000;

    // This transaction IS a Whirlpool CoinJoin (5 equal outputs at a Whirlpool denom)
    // that happens to spend outputs from prior CoinJoins (remixing)
    const tx = makeTx({
      vin: [
        makeVinObj("cj1", 0, "bc1qa", denom),
        makeVinObj("cj2", 1, "bc1qb", denom),
        makeVinObj("cj1", 2, "bc1qc", denom),
        makeVinObj("cj2", 3, "bc1qd", denom),
        makeVinObj("cj1", 4, "bc1qe", denom),
      ],
      vout: Array.from({ length: 5 }, (_, i) =>
        makeVoutObj(`bc1qout${i}`, denom),
      ),
    });

    const { findings } = analyzePostMix(tx, undefined, {
      parentTxs: new Map([["cj1", parent1], ["cj2", parent2]]),
    });

    expect(findings).toHaveLength(0);
  });

  it("should detect same-CoinJoin consolidation (2 outputs from the same mix)", () => {
    const parent = makeWhirlpoolParent("samecj");

    const tx = makeTx({
      vin: [
        makeVinObj("samecj", 0, "bc1qa", 5_000_000),
        makeVinObj("samecj", 1, "bc1qb", 5_000_000),
      ],
      vout: [makeVoutObj("bc1qc", 9_999_000)],
    });

    const { findings } = analyzePostMix(tx, undefined, {
      parentTxs: new Map([["samecj", parent]]),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("post-mix-consolidation");
    // Only 1 distinct CoinJoin
    expect(findings[0].params?.distinctCoinJoins).toBe(1);
  });
});
