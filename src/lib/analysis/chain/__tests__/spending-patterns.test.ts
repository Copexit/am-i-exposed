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

  it("detects hop 1 when parent is Ashigaru Ricochet hop 0", () => {
    const hop0Txid = "d".repeat(64);

    // This tx: hop 1 (1 in, 1 out sweep)
    const tx = makeTx({
      vin: [makeVin({ txid: hop0Txid, vout: 1 })],
      vout: [makeVout({ value: 572_880 })],
    });

    // Parent is hop 0: pays Ashigaru fee address
    const hop0Tx = makeTx({
      txid: hop0Txid,
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qsender000000000000000000000000000000", value: 778_199 } })],
      vout: [
        makeVout({ value: 100_000, scriptpubkey_address: "bc1qsc887pxce0r3qed50e8he49a3amenemgptakg2" }),
        makeVout({ value: 573_840 }),
        makeVout({ value: 104_359 }),
      ],
    });

    const parentTxs = new Map<number, MempoolTransaction>([[0, hop0Tx]]);
    const result = detectRicochet(tx, parentTxs);

    expect(result).not.toBeNull();
    expect(result!.id).toBe("chain-ricochet");
    expect(result!.title).toContain("Ricochet (Ashigaru)");
    expect(result!.title).toContain("hop");
    expect(result!.params?.wallet).toBe("Ashigaru");
    expect(result!.scoreImpact).toBe(5);
  });

  it("detects hop with 2-output PayNym variant when parent is hop 0", () => {
    const hop0Txid = "e".repeat(64);

    // This tx: PayNym hop (1 in, 2 out - sweep + fee split)
    const tx = makeTx({
      vin: [makeVin({ txid: hop0Txid, vout: 1 })],
      vout: [makeVout({ value: 545_000 }), makeVout({ value: 25_000 })],
    });

    // Parent is hop 0
    const hop0Tx = makeTx({
      txid: hop0Txid,
      vin: [makeVin()],
      vout: [
        makeVout({ value: 100_000, scriptpubkey_address: "bc1qsc887pxce0r3qed50e8he49a3amenemgptakg2" }),
        makeVout({ value: 573_840 }),
        makeVout({ value: 104_359 }),
      ],
    });

    const parentTxs = new Map<number, MempoolTransaction>([[0, hop0Tx]]);
    const result = detectRicochet(tx, parentTxs);

    expect(result).not.toBeNull();
    expect(result!.id).toBe("chain-ricochet");
    expect(result!.title).toContain("Ashigaru");
  });

  it("detects hop 3 via multi-hop backward walk through allBackwardTxs", () => {
    const hop0Txid = "f".repeat(64);
    const hop1Txid = "1".repeat(64);
    const hop2Txid = "2".repeat(64);

    // This tx is hop 3 (1 in, 1 out sweep)
    const tx = makeTx({
      vin: [makeVin({ txid: hop2Txid, vout: 0 })],
      vout: [makeVout({ value: 570_960 })],
    });

    // Hop 2: sweep
    const hop2Tx = makeTx({
      txid: hop2Txid,
      vin: [makeVin({ txid: hop1Txid, vout: 0 })],
      vout: [makeVout({ value: 571_920 })],
    });

    // Hop 1: sweep
    const hop1Tx = makeTx({
      txid: hop1Txid,
      vin: [makeVin({ txid: hop0Txid, vout: 1 })],
      vout: [makeVout({ value: 572_880 })],
    });

    // Hop 0: Ashigaru fee
    const hop0Tx = makeTx({
      txid: hop0Txid,
      vin: [makeVin()],
      vout: [
        makeVout({ value: 100_000, scriptpubkey_address: "bc1qsc887pxce0r3qed50e8he49a3amenemgptakg2" }),
        makeVout({ value: 573_840 }),
        makeVout({ value: 104_359 }),
      ],
    });

    // parentTxs only has the immediate parent (hop 2)
    const parentTxs = new Map<number, MempoolTransaction>([[0, hop2Tx]]);

    // allBackwardTxs has the full chain
    const allBackwardTxs = new Map<string, MempoolTransaction>([
      [hop2Txid, hop2Tx],
      [hop1Txid, hop1Tx],
      [hop0Txid, hop0Tx],
    ]);

    const result = detectRicochet(tx, parentTxs, allBackwardTxs);

    expect(result).not.toBeNull();
    expect(result!.id).toBe("chain-ricochet");
    expect(result!.title).toBe("Ricochet (Ashigaru) hop 3");
    expect(result!.params?.hopNumber).toBe(3);
    expect(result!.params?.wallet).toBe("Ashigaru");
  });

  it("does not detect ricochet when backward chain has no hop 0", () => {
    const parent1Txid = "3".repeat(64);
    const parent2Txid = "4".repeat(64);

    const tx = makeTx({
      vin: [makeVin({ txid: parent1Txid, vout: 0 })],
      vout: [makeVout({ value: 98_500 })],
    });

    // Two levels of sweeps but no hop 0 at the root
    const parent1 = makeTx({
      txid: parent1Txid,
      vin: [makeVin({ txid: parent2Txid, vout: 0 })],
      vout: [makeVout({ value: 99_000 })],
    });
    const parent2 = makeTx({
      txid: parent2Txid,
      vin: [makeVin()],
      vout: [makeVout({ value: 99_500 })],
    });

    const parentTxs = new Map<number, MempoolTransaction>([[0, parent1]]);
    const allBackwardTxs = new Map<string, MempoolTransaction>([
      [parent1Txid, parent1],
      [parent2Txid, parent2],
    ]);

    const result = detectRicochet(tx, parentTxs, allBackwardTxs);

    // Should detect as sweep-chain, NOT chain-ricochet (no hop 0 found)
    expect(result).not.toBeNull();
    expect(result!.id).toBe("chain-sweep-chain");
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

describe("detectPostMixConsolidation (via analyzeSpendingPatterns)", () => {
  const denom = WHIRLPOOL_DENOMS[3]; // 5_000_000

  function makeWhirlpoolParent(txid: string): MempoolTransaction {
    return makeTx({
      txid,
      vin: Array.from({ length: 5 }, () => makeVin()),
      vout: Array.from({ length: 5 }, () => makeVout({ value: denom })),
    });
  }

  it("flags medium severity when 2 inputs from different CoinJoins (no direct penalty)", () => {
    const cj1 = makeWhirlpoolParent("c".repeat(64));
    const cj2 = makeWhirlpoolParent("d".repeat(64));

    const tx = makeTx({
      vin: [
        makeVin({ txid: cj1.txid, vout: 0, prevout: { scriptpubkey: "0014aa", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa", value: denom } }),
        makeVin({ txid: cj2.txid, vout: 1, prevout: { scriptpubkey: "0014bb", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qb", value: denom } }),
      ],
      vout: [makeVout({ value: 9_998_500 })],
    });

    const parentTxs = new Map<number, MempoolTransaction>([[0, cj1], [1, cj2]]);
    const result = analyzeSpendingPatterns(tx, parentTxs, [0, 1], null, new Map());

    const finding = result.findings.find((f) => f.id === "chain-post-mix-consolidation");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.scoreImpact).toBe(0); // Warning only, CJ bonus reduced instead
    expect(finding!.params?.distinctCoinJoins).toBe(2);
  });

  it("flags medium severity for 3 inputs, high for 4+", () => {
    const cj1 = makeWhirlpoolParent("c".repeat(64));
    const cj2 = makeWhirlpoolParent("d".repeat(64));
    const cj3 = makeWhirlpoolParent("e".repeat(64));

    const tx3 = makeTx({
      vin: [
        makeVin({ txid: cj1.txid, vout: 0, prevout: { scriptpubkey: "0014aa", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa", value: denom } }),
        makeVin({ txid: cj2.txid, vout: 1, prevout: { scriptpubkey: "0014bb", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qb", value: denom } }),
        makeVin({ txid: cj3.txid, vout: 2, prevout: { scriptpubkey: "0014cc", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qc", value: denom } }),
      ],
      vout: [makeVout({ value: 14_997_500 })],
    });

    const result3 = analyzeSpendingPatterns(tx3, new Map([[0, cj1], [1, cj2], [2, cj3]]), [0, 1, 2], null, new Map());
    expect(result3.findings.find((f) => f.id === "chain-post-mix-consolidation")!.severity).toBe("medium");

    // 4 inputs -> high
    const cj4 = makeWhirlpoolParent("f".repeat(64));
    const tx4 = makeTx({
      vin: [
        makeVin({ txid: cj1.txid, vout: 0, prevout: { scriptpubkey: "0014aa", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa", value: denom } }),
        makeVin({ txid: cj2.txid, vout: 1, prevout: { scriptpubkey: "0014bb", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qb", value: denom } }),
        makeVin({ txid: cj3.txid, vout: 2, prevout: { scriptpubkey: "0014cc", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qc", value: denom } }),
        makeVin({ txid: cj4.txid, vout: 3, prevout: { scriptpubkey: "0014dd", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qd", value: denom } }),
      ],
      vout: [makeVout({ value: 19_996_500 })],
    });

    const result4 = analyzeSpendingPatterns(tx4, new Map([[0, cj1], [1, cj2], [2, cj3], [3, cj4]]), [0, 1, 2, 3], null, new Map());
    expect(result4.findings.find((f) => f.id === "chain-post-mix-consolidation")!.severity).toBe("high");
  });

  it("flags when 2 inputs from the same CoinJoin", () => {
    const cj = makeWhirlpoolParent("c".repeat(64));

    const tx = makeTx({
      vin: [
        makeVin({ txid: cj.txid, vout: 0, prevout: { scriptpubkey: "0014aa", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa", value: denom } }),
        makeVin({ txid: cj.txid, vout: 1, prevout: { scriptpubkey: "0014bb", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qb", value: denom } }),
      ],
      vout: [makeVout({ value: 9_998_500 })],
    });

    const parentTxs = new Map<number, MempoolTransaction>([[0, cj], [1, cj]]);
    const result = analyzeSpendingPatterns(tx, parentTxs, [0, 1], null, new Map());

    const finding = result.findings.find((f) => f.id === "chain-post-mix-consolidation");
    expect(finding).toBeDefined();
    expect(finding!.params?.distinctCoinJoins).toBe(1);
  });

  it("does NOT flag when only 1 CoinJoin input", () => {
    const cj = makeWhirlpoolParent("c".repeat(64));

    const tx = makeTx({
      vin: [
        makeVin({ txid: cj.txid, vout: 0 }),
        makeVin(), // normal input
      ],
      vout: [makeVout({ value: 5_098_500 })],
    });

    const parentTxs = new Map<number, MempoolTransaction>([[0, cj]]);
    const result = analyzeSpendingPatterns(tx, parentTxs, [0], null, new Map());

    const finding = result.findings.find((f) => f.id === "chain-post-mix-consolidation");
    expect(finding).toBeUndefined();
  });

  it("does NOT flag when current tx is a CoinJoin (remixing)", () => {
    const cj1 = makeWhirlpoolParent("c".repeat(64));
    const cj2 = makeWhirlpoolParent("d".repeat(64));

    // Current tx is itself a Whirlpool CoinJoin
    const tx = makeTx({
      vin: Array.from({ length: 5 }, (_, i) =>
        makeVin({ txid: i < 2 ? [cj1.txid, cj2.txid][i] : "a".repeat(64), vout: i }),
      ),
      vout: Array.from({ length: 5 }, () => makeVout({ value: denom })),
    });

    const parentTxs = new Map<number, MempoolTransaction>([[0, cj1], [1, cj2]]);
    const result = analyzeSpendingPatterns(tx, parentTxs, [0, 1], null, new Map());

    const finding = result.findings.find((f) => f.id === "chain-post-mix-consolidation");
    expect(finding).toBeUndefined();
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
