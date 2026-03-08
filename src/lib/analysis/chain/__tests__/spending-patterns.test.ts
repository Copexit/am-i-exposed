import { describe, it, expect, beforeEach } from "vitest";
import {
  detectPartialSpendWarning,
  detectRicochet,
  detectPostCoinJoinPartialSpend,
  detectKycConsolidationBeforeCJ,
  analyzeSpendingPatterns,
} from "../spending-patterns";
import {
  makeTx,
  makeVin,
  makeVout,
  resetAddrCounter,
} from "../../heuristics/__tests__/fixtures/tx-factory";
import { WHIRLPOOL_DENOMS } from "@/lib/constants";
import type { MempoolOutspend, MempoolTransaction } from "@/lib/api/types";

beforeEach(() => resetAddrCounter());

function makeOutspend(overrides: Partial<MempoolOutspend> = {}): MempoolOutspend {
  return { spent: false, txid: undefined, vin: undefined, status: undefined, ...overrides };
}

describe("detectPartialSpendWarning", () => {
  it("flags near-exact spend when change < 5% of input", () => {
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "0014aaa", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qtest", value: 100_000 } })],
      vout: [
        makeVout({ value: 96_000 }), // payment
        makeVout({ value: 2_500 }),   // tiny change (2.5% of input)
      ],
      fee: 1_500,
    });

    const result = detectPartialSpendWarning(tx);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("chain-near-exact-spend");
    expect(result!.severity).toBe("low");
  });

  it("does not flag when change is >= 5%", () => {
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "0014aaa", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qtest", value: 100_000 } })],
      vout: [
        makeVout({ value: 80_000 }),
        makeVout({ value: 18_500 }),
      ],
      fee: 1_500,
    });

    const result = detectPartialSpendWarning(tx);
    expect(result).toBeNull();
  });

  it("does not flag single-output transactions", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [makeVout({ value: 98_500 })],
      fee: 1_500,
    });

    const result = detectPartialSpendWarning(tx);
    expect(result).toBeNull();
  });
});

describe("detectRicochet", () => {
  it("detects ricochet from CoinJoin origin", () => {
    const cjTxid = "c".repeat(64);
    const denom = WHIRLPOOL_DENOMS[3]; // 5_000_000

    // This tx: 1 in, 1 out (sweep)
    const tx = makeTx({
      vin: [makeVin({ txid: cjTxid, vout: 0 })],
      vout: [makeVout({ value: 4_998_500 })],
    });

    // Parent is a Whirlpool CoinJoin
    const parentTx = makeTx({
      txid: cjTxid,
      vin: Array.from({ length: 5 }, () => makeVin()),
      vout: Array.from({ length: 5 }, () => makeVout({ value: denom })),
    });

    const parentTxs = new Map<number, MempoolTransaction>([[0, parentTx]]);
    const result = detectRicochet(tx, parentTxs);

    expect(result).not.toBeNull();
    expect(result!.id).toBe("chain-ricochet");
    expect(result!.severity).toBe("good");
    expect(result!.scoreImpact).toBe(5);
  });

  it("detects sweep chain without CoinJoin origin", () => {
    const parentTxid = "b".repeat(64);

    // This tx: 1 in, 1 out (sweep)
    const tx = makeTx({
      vin: [makeVin({ txid: parentTxid, vout: 0 })],
      vout: [makeVout({ value: 98_500 })],
    });

    // Parent is also a sweep (1 in, 1 out)
    const parentTx = makeTx({
      txid: parentTxid,
      vin: [makeVin()],
      vout: [makeVout({ value: 99_000 })],
    });

    const parentTxs = new Map<number, MempoolTransaction>([[0, parentTx]]);
    const result = detectRicochet(tx, parentTxs);

    expect(result).not.toBeNull();
    expect(result!.id).toBe("chain-sweep-chain");
    expect(result!.severity).toBe("low");
  });

  it("returns null for non-sweep transactions", () => {
    const tx = makeTx({
      vin: [makeVin(), makeVin()],
      vout: [makeVout()],
    });

    const result = detectRicochet(tx, new Map());
    expect(result).toBeNull();
  });
});

describe("detectPostCoinJoinPartialSpend", () => {
  it("flags partial spend of CoinJoin output", () => {
    const denom = WHIRLPOOL_DENOMS[3]; // 5_000_000
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "0014aaa", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qtest", value: denom } })],
      vout: [
        makeVout({ value: 4_800_000 }), // payment
        makeVout({ value: 198_500 }),     // change
      ],
      fee: 1_500,
    });

    const result = detectPostCoinJoinPartialSpend(tx, [0]);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("chain-post-cj-partial-spend");
    expect(result!.severity).toBe("high");
    expect(result!.scoreImpact).toBe(-8);
  });

  it("does not flag full spend of CoinJoin output", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [makeVout({ value: 98_500 })],
    });

    const result = detectPostCoinJoinPartialSpend(tx, [0]);
    expect(result).toBeNull(); // 1 output = full spend
  });

  it("does not flag when no CoinJoin inputs", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [makeVout({ value: 80_000 }), makeVout({ value: 18_500 })],
    });

    const result = detectPostCoinJoinPartialSpend(tx, []);
    expect(result).toBeNull();
  });
});

describe("detectKycConsolidationBeforeCJ", () => {
  it("detects consolidation feeding into CoinJoin", () => {
    const txid = "a".repeat(64);
    // Consolidation tx: many inputs, 1 output
    const tx = makeTx({
      txid,
      vin: [
        makeVin({ prevout: { scriptpubkey: "0014aaa", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa", value: 50_000 } }),
        makeVin({ prevout: { scriptpubkey: "0014bbb", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qb", value: 50_000 } }),
        makeVin({ prevout: { scriptpubkey: "0014ccc", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qc", value: 50_000 } }),
      ],
      vout: [makeVout({ value: 148_500 })],
    });

    // Child is a Whirlpool CoinJoin
    const denom = WHIRLPOOL_DENOMS[0];
    const childTx = makeTx({
      vin: [
        makeVin({ txid, vout: 0 }),
        makeVin(),
        makeVin(),
        makeVin(),
        makeVin(),
      ],
      vout: Array.from({ length: 5 }, () => makeVout({ value: denom })),
    });

    const outspends: MempoolOutspend[] = [
      makeOutspend({ spent: true, txid: childTx.txid }),
    ];

    const childTxs = new Map<number, MempoolTransaction>([[0, childTx]]);
    const result = detectKycConsolidationBeforeCJ(tx, outspends, childTxs);

    expect(result).not.toBeNull();
    expect(result!.id).toBe("chain-kyc-consolidation-before-cj");
    expect(result!.severity).toBe("good");
    expect(result!.scoreImpact).toBe(5);
  });

  it("returns null when child is not CoinJoin", () => {
    const txid = "a".repeat(64);
    const tx = makeTx({
      txid,
      vin: [makeVin(), makeVin()],
      vout: [makeVout({ value: 198_500 })],
    });

    const childTx = makeTx({
      vin: [makeVin({ txid, vout: 0 })],
      vout: [makeVout(), makeVout()],
    });

    const outspends: MempoolOutspend[] = [
      makeOutspend({ spent: true, txid: childTx.txid }),
    ];

    const childTxs = new Map<number, MempoolTransaction>([[0, childTx]]);
    const result = detectKycConsolidationBeforeCJ(tx, outspends, childTxs);

    expect(result).toBeNull();
  });
});

describe("analyzeSpendingPatterns", () => {
  it("combines all pattern detections", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [makeVout({ value: 80_000 }), makeVout({ value: 18_500 })],
    });

    const result = analyzeSpendingPatterns(
      tx,
      new Map(),
      [],
      null,
      new Map(),
    );

    expect(result.isRicochet).toBe(false);
    expect(result.isKycConsolidationBeforeCJ).toBe(false);
    expect(result.postCjPartialSpends).toHaveLength(0);
  });
});
