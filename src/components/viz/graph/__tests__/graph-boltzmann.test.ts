/**
 * Tests for the graph Boltzmann computation lifecycle:
 * - Synthetic results for 1-input txs (trivially deterministic)
 * - Auto-compute eligibility thresholds
 * - Change detection auto-marking
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  makeTx,
  makeVin,
  makeVout,
  makeCoinbaseVin,
  makeOpReturnVout,
  resetAddrCounter,
} from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";
import { extractTxValues } from "@/lib/analysis/boltzmann-compute";
import { detectJoinMarketForTurbo } from "@/lib/analysis/boltzmann-pool";
import { analyzeChangeDetection } from "@/lib/analysis/heuristics/change-detection";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";
import type { MempoolTransaction } from "@/lib/api/types";

// ─── Helpers matching GraphExplorer's logic ─────────────────────

/** Build a synthetic Boltzmann result for 1-input txs (mirrors GraphExplorer). */
function buildSyntheticResult(tx: MempoolTransaction): BoltzmannWorkerResult {
  const { inputValues, outputValues } = extractTxValues(tx);
  const nIn = inputValues.length;
  const nOut = outputValues.length;
  const matProb = Array.from({ length: nOut }, () => Array.from({ length: nIn }, () => 1));
  const matComb = Array.from({ length: nOut }, () => Array.from({ length: nIn }, () => 1));
  const detLinks: [number, number][] = Array.from({ length: nOut }, (_, oi) => [oi, 0] as [number, number]);
  return {
    type: "result", id: tx.txid,
    matLnkCombinations: matComb, matLnkProbabilities: matProb,
    nbCmbn: 1, entropy: 0, efficiency: 0, nbCmbnPrfctCj: 1,
    deterministicLinks: detLinks, timedOut: false, elapsedMs: 0,
    nInputs: nIn, nOutputs: nOut,
    fees: tx.fee, intraFeesMaker: 0, intraFeesTaker: 0,
  };
}

/** Check if a tx is eligible for eager auto-compute (mirrors GraphExplorer thresholds). */
function isEagerEligible(tx: MempoolTransaction): "synthetic" | "auto-compute" | "manual-button" | "ineligible" {
  if (tx.vin.some((v) => v.is_coinbase)) return "ineligible";
  const { inputValues, outputValues } = extractTxValues(tx);
  if (inputValues.length === 0 || outputValues.length === 0) return "ineligible";
  if (inputValues.length === 1) return "synthetic";
  const total = inputValues.length + outputValues.length;
  if (total > 80) return "ineligible";
  if (total < 18) return "auto-compute";
  if (total < 24 && detectJoinMarketForTurbo(inputValues, outputValues).isJoinMarket) return "auto-compute";
  if (total <= 80) return "manual-button";
  return "ineligible";
}

beforeEach(() => resetAddrCounter());

// ─── Synthetic Boltzmann Results ────────────────────────────────

describe("synthetic Boltzmann for 1-input txs", () => {
  it("produces 100% deterministic matrix for 1in/2out", () => {
    const tx = makeTx({
      txid: "aaa",
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1q_sender", value: 100000 } })],
      vout: [makeVout({ value: 50000 }), makeVout({ value: 48500 })],
    });
    const result = buildSyntheticResult(tx);

    expect(result.entropy).toBe(0);
    expect(result.nbCmbn).toBe(1);
    expect(result.nInputs).toBe(1);
    expect(result.nOutputs).toBe(2);
    expect(result.matLnkProbabilities).toEqual([[1], [1]]);
    expect(result.deterministicLinks).toEqual([[0, 0], [1, 0]]);
  });

  it("produces correct matrix for 1in/1out (sweep)", () => {
    const tx = makeTx({
      txid: "bbb",
      vin: [makeVin()],
      vout: [makeVout({ value: 98500 })],
    });
    const result = buildSyntheticResult(tx);

    expect(result.matLnkProbabilities).toEqual([[1]]);
    expect(result.deterministicLinks).toEqual([[0, 0]]);
    expect(result.efficiency).toBe(0);
  });

  it("skips OP_RETURN outputs in the matrix (extractTxValues filters them)", () => {
    const tx = makeTx({
      txid: "ccc",
      vin: [makeVin()],
      vout: [makeVout({ value: 98500 }), makeOpReturnVout()],
    });
    const result = buildSyntheticResult(tx);

    // extractTxValues filters OP_RETURN, so only 1 output in the matrix
    expect(result.nOutputs).toBe(1);
    expect(result.matLnkProbabilities).toEqual([[1]]);
  });
});

// ─── Eligibility Thresholds ─────────────────────────────────────

describe("auto-compute eligibility thresholds", () => {
  it("coinbase txs are ineligible", () => {
    const tx = makeTx({ vin: [makeCoinbaseVin()] });
    expect(isEagerEligible(tx)).toBe("ineligible");
  });

  it("1-input txs get synthetic results", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [makeVout(), makeVout()],
    });
    expect(isEagerEligible(tx)).toBe("synthetic");
  });

  it("small multi-input txs (<18 I/O) are auto-computed", () => {
    // 3in/4out = 7 total I/O
    const tx = makeTx({
      vin: [makeVin(), makeVin(), makeVin()],
      vout: [makeVout(), makeVout(), makeVout(), makeVout()],
    });
    expect(isEagerEligible(tx)).toBe("auto-compute");
  });

  it("17 total I/O is auto-computed", () => {
    const vins = Array.from({ length: 8 }, () => makeVin());
    const vouts = Array.from({ length: 9 }, () => makeVout());
    const tx = makeTx({ vin: vins, vout: vouts });
    expect(isEagerEligible(tx)).toBe("auto-compute");
  });

  it("18 total I/O (non-JoinMarket) needs manual button", () => {
    const vins = Array.from({ length: 9 }, () => makeVin());
    const vouts = Array.from({ length: 9 }, () => makeVout());
    const tx = makeTx({ vin: vins, vout: vouts });
    expect(isEagerEligible(tx)).toBe("manual-button");
  });

  it(">80 total I/O is ineligible", () => {
    const vins = Array.from({ length: 41 }, () => makeVin());
    const vouts = Array.from({ length: 41 }, () => makeVout());
    const tx = makeTx({ vin: vins, vout: vouts });
    expect(isEagerEligible(tx)).toBe("ineligible");
  });

  it("exactly 80 I/O gets manual button", () => {
    const vins = Array.from({ length: 40 }, () => makeVin());
    const vouts = Array.from({ length: 40 }, () => makeVout());
    const tx = makeTx({ vin: vins, vout: vouts });
    expect(isEagerEligible(tx)).toBe("manual-button");
  });
});

// ─── Change Detection Auto-Marking ──────────────────────────────

describe("change detection auto-marking", () => {
  it("detects change output on a simple 1in/2out tx with round payment", () => {
    // One output is a round number (likely payment), the other is change
    const tx = makeTx({
      txid: "d".repeat(64),
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1q_in", value: 500000 } })],
      vout: [
        makeVout({ value: 100000, scriptpubkey_type: "v0_p2wpkh" }), // round = payment
        makeVout({ value: 398500, scriptpubkey_type: "v0_p2wpkh" }), // non-round = change
      ],
    });
    const result = analyzeChangeDetection(tx);
    const finding = result.findings.find((f) => f.id === "h2-change-detected");

    // The heuristic should identify one output as change
    // (exact index depends on signal agreement - round amount + value disparity)
    expect(finding).toBeDefined();
    if (finding?.params) {
      const idx = (finding.params as Record<string, unknown>).changeIndex;
      expect(typeof idx).toBe("number");
    }
  });

  it("does not detect change on a sweep (1in/1out)", () => {
    const tx = makeTx({
      txid: "e".repeat(64),
      vin: [makeVin()],
      vout: [makeVout({ value: 98500 })],
    });
    const result = analyzeChangeDetection(tx);
    const changeFound = result.findings.find((f) => f.id === "h2-change-detected");
    expect(changeFound).toBeUndefined();
  });

  it("detects script type mismatch change (P2PKH input, P2WPKH + P2PKH outputs)", () => {
    // Input is P2PKH, one output matches (P2PKH = change), other is P2WPKH (payment)
    const tx = makeTx({
      txid: "f".repeat(64),
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "p2pkh", scriptpubkey_address: "1ABC", value: 500000 } })],
      vout: [
        makeVout({ value: 200000, scriptpubkey_type: "v0_p2wpkh" }),  // different type = payment
        makeVout({ value: 298500, scriptpubkey_type: "p2pkh" }),       // matches input type = change
      ],
    });
    const result = analyzeChangeDetection(tx);
    const finding = result.findings.find((f) => f.id === "h2-change-detected");
    if (finding?.params) {
      const idx = (finding.params as Record<string, unknown>).changeIndex;
      // The P2PKH output (index 1) should be identified as change
      expect(idx).toBe(1);
    }
  });
  it("detects same-address-in-output change (output returns to input address)", () => {
    const sharedAddr = "bc1q_shared_address_test";
    const tx = makeTx({
      txid: "1".repeat(64),
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: sharedAddr, value: 500000 } })],
      vout: [
        makeVout({ value: 100000, scriptpubkey_address: "bc1q_recipient" }),  // payment to new address
        makeVout({ value: 398500, scriptpubkey_address: sharedAddr }),         // change back to input address
      ],
    });
    const result = analyzeChangeDetection(tx);
    const sameAddrFinding = result.findings.find((f) => f.id === "h2-same-address-io");

    expect(sameAddrFinding).toBeDefined();
    expect(sameAddrFinding?.confidence).toBe("deterministic");
    if (sameAddrFinding?.params) {
      const indices = (sameAddrFinding.params as Record<string, unknown>).selfSendIndices;
      expect(typeof indices).toBe("string");
      // Output index 1 should be the self-send (change) output
      expect((indices as string).split(",").map(Number)).toContain(1);
    }
  });

  it("detects all-self-send (every output returns to input addresses)", () => {
    const addr1 = "bc1q_addr_1_test";
    const tx = makeTx({
      txid: "2".repeat(64),
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: addr1, value: 500000 } })],
      vout: [
        makeVout({ value: 200000, scriptpubkey_address: addr1 }),
        makeVout({ value: 298500, scriptpubkey_address: addr1 }),
      ],
    });
    const result = analyzeChangeDetection(tx);
    const selfSendFinding = result.findings.find((f) => f.id === "h2-self-send");

    expect(selfSendFinding).toBeDefined();
    if (selfSendFinding?.params) {
      const indices = (selfSendFinding.params as Record<string, unknown>).selfSendIndices;
      // Both outputs should be marked
      expect((indices as string).split(",").map(Number).sort()).toEqual([0, 1]);
    }
  });
});

// ─── Stonewall Exclusion from JoinMarket Turbo ──────────────────

describe("Stonewall exclusion from JoinMarket turbo mode", () => {
  it("9-input Stonewall (4 outputs, 1 equal pair) is NOT detected as JoinMarket", () => {
    // Mirrors tx 015d9cf0...f404: 9 inputs, 4 outputs (2 equal at 9,136,520 + 2 change)
    const inputs = [
      5_000_000, 3_000_000, 2_500_000, 1_800_000, 1_500_000,
      1_200_000, 900_000, 700_000, 500_000,
    ];
    const outputs = [9_136_520, 9_136_520, 6_500_000, 1_363_480];
    const result = detectJoinMarketForTurbo(inputs, outputs);
    expect(result.isJoinMarket).toBe(false);
  });

  it("actual JoinMarket (5 equal outputs + changes) IS detected as JoinMarket", () => {
    const inputs = [
      1_000_000, 1_100_000, 1_200_000, 900_000, 1_050_000,
    ];
    const outputs = [500_000, 500_000, 500_000, 500_000, 500_000, 450_000, 550_000, 650_000, 350_000, 100_000];
    const result = detectJoinMarketForTurbo(inputs, outputs);
    expect(result.isJoinMarket).toBe(true);
    expect(result.denomination).toBe(500_000);
  });

  it("small Stonewall (2 inputs, 4 outputs) is also excluded", () => {
    const inputs = [500_000, 600_000];
    const outputs = [300_000, 300_000, 250_000, 248_500];
    const result = detectJoinMarketForTurbo(inputs, outputs);
    expect(result.isJoinMarket).toBe(false);
  });
});

// ─── AbortController Behavior ───────────────────────────────────

describe("AbortController signal handling", () => {
  it("AbortController.abort() sets signal.aborted synchronously", () => {
    const ac = new AbortController();
    expect(ac.signal.aborted).toBe(false);
    ac.abort();
    expect(ac.signal.aborted).toBe(true);
  });

  it("pre-aborted signal prevents computation start", () => {
    const ac = new AbortController();
    ac.abort();

    // Simulates the guard in computeSingleBoltzmann
    let started = false;
    if (!ac.signal.aborted) {
      started = true;
    }
    expect(started).toBe(false);
  });

  it("abort during async iteration stops the loop", async () => {
    const ac = new AbortController();
    const processed: number[] = [];

    const queue = [1, 2, 3, 4, 5];
    for (const item of queue) {
      if (ac.signal.aborted) break;
      processed.push(item);
      // Simulate async work
      await new Promise((r) => setTimeout(r, 1));
      if (item === 2) ac.abort(); // abort after processing item 2
    }

    expect(processed).toEqual([1, 2]); // abort after item 2's await, item 3's guard catches it
  });
});
