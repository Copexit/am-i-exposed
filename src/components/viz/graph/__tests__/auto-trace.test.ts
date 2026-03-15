/**
 * Tests for auto-trace utilities:
 * - identifyChangeOutput (peel chain direction picking)
 * - Deterministic chain computation
 * - Toxic change detection
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
import { identifyChangeOutput } from "../autoTrace";
import { computeDeterministicChains } from "../deterministicChains";
import { detectToxicMerges } from "../toxicChange";
import type { GraphNode } from "@/hooks/useGraphExpansion";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";

beforeEach(() => resetAddrCounter());

// ─── identifyChangeOutput ───────────────────────────────────────

describe("identifyChangeOutput", () => {
  it("returns null for CoinJoin transactions", () => {
    // Whirlpool-like: 5 equal outputs
    const tx = makeTx({
      vin: [makeVin(), makeVin(), makeVin(), makeVin(), makeVin()],
      vout: [
        makeVout({ value: 100000 }),
        makeVout({ value: 100000 }),
        makeVout({ value: 100000 }),
        makeVout({ value: 100000 }),
        makeVout({ value: 100000 }),
      ],
    });
    const result = identifyChangeOutput(tx);
    expect(result.changeOutputIndex).toBeNull();
    expect(result.reason).toBe("coinjoin");
  });

  it("returns the only spendable output for sweep txs (1in/1out)", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [makeVout({ value: 98500 })],
    });
    const result = identifyChangeOutput(tx);
    expect(result.changeOutputIndex).toBe(0);
    expect(result.reason).toBe("single-spendable");
    expect(result.confidence).toBe("high");
  });

  it("identifies same-address change (deterministic)", () => {
    const sharedAddr = "bc1q_shared_test_addr";
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: sharedAddr, value: 500000 } })],
      vout: [
        makeVout({ value: 100000 }),                                // payment
        makeVout({ value: 398500, scriptpubkey_address: sharedAddr }), // change back to input addr
      ],
    });
    const result = identifyChangeOutput(tx);
    expect(result.changeOutputIndex).toBe(1);
    expect(result.reason).toBe("same-address-io");
    expect(result.confidence).toBe("deterministic");
  });

  it("returns null for no spendable outputs", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [makeOpReturnVout()],
    });
    const result = identifyChangeOutput(tx);
    expect(result.changeOutputIndex).toBeNull();
    expect(result.reason).toBe("no-spendable");
  });

  it("uses heuristic consensus for round-amount change", () => {
    const tx = makeTx({
      vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1q_sender", value: 500000 } })],
      vout: [
        makeVout({ value: 100000, scriptpubkey_type: "v0_p2wpkh" }), // round = payment
        makeVout({ value: 398500, scriptpubkey_type: "v0_p2wpkh" }), // non-round = change
      ],
    });
    const result = identifyChangeOutput(tx);
    // Should identify one of them as change (exact index depends on heuristic signals)
    expect(result.changeOutputIndex).not.toBeNull();
    expect(["change-detected", "same-address-io"]).toContain(result.reason);
  });
});

// ─── Deterministic chain computation ────────────────────────────

describe("computeDeterministicChains", () => {
  it("returns empty for no Boltzmann data", () => {
    const nodes = new Map<string, GraphNode>();
    const cache = new Map<string, BoltzmannWorkerResult>();
    expect(computeDeterministicChains(nodes, cache)).toEqual([]);
  });

  it("finds a 2-hop deterministic chain", () => {
    const txA = makeTx({ txid: "a".repeat(64), vin: [makeVin()], vout: [makeVout({ value: 50000 }), makeVout({ value: 48000 })] });
    const txB = makeTx({
      txid: "b".repeat(64),
      vin: [makeVin({ txid: "a".repeat(64), vout: 0 })],
      vout: [makeVout({ value: 25000 }), makeVout({ value: 23000 })],
    });
    const txC = makeTx({
      txid: "c".repeat(64),
      vin: [makeVin({ txid: "b".repeat(64), vout: 1 })],
      vout: [makeVout({ value: 21000 })],
    });

    const nodes = new Map<string, GraphNode>([
      ["a".repeat(64), { txid: "a".repeat(64), tx: txA, depth: 0 }],
      ["b".repeat(64), { txid: "b".repeat(64), tx: txB, depth: 1, parentEdge: { fromTxid: "a".repeat(64), outputIndex: 0 } }],
      ["c".repeat(64), { txid: "c".repeat(64), tx: txC, depth: 2, parentEdge: { fromTxid: "b".repeat(64), outputIndex: 1 } }],
    ]);

    // Boltzmann data: txA has deterministic link output 0 -> input 0
    // txB has deterministic link output 1 -> input 0
    const boltzA: BoltzmannWorkerResult = {
      type: "result", id: "a", matLnkCombinations: [[1], [1]], matLnkProbabilities: [[1], [1]],
      nbCmbn: 1, entropy: 0, efficiency: 0, nbCmbnPrfctCj: 1,
      deterministicLinks: [[0, 0]], // output 0 deterministically linked to input 0
      timedOut: false, elapsedMs: 0, nInputs: 1, nOutputs: 2, fees: 1500, intraFeesMaker: 0, intraFeesTaker: 0,
    };
    const boltzB: BoltzmannWorkerResult = {
      ...boltzA, id: "b",
      deterministicLinks: [[1, 0]], // output 1 deterministically linked to input 0
    };

    const cache = new Map<string, BoltzmannWorkerResult>([
      ["a".repeat(64), boltzA],
      ["b".repeat(64), boltzB],
    ]);

    const chains = computeDeterministicChains(nodes, cache);
    expect(chains.length).toBe(1);
    expect(chains[0].length).toBe(2);
    expect(chains[0].hops[0].fromTxid).toBe("a".repeat(64));
    expect(chains[0].hops[0].toTxid).toBe("b".repeat(64));
    expect(chains[0].hops[1].fromTxid).toBe("b".repeat(64));
    expect(chains[0].hops[1].toTxid).toBe("c".repeat(64));
  });
});

// ─── Toxic change detection ─────────────────────────────────────

describe("detectToxicMerges", () => {
  it("returns empty when no CoinJoins in graph", () => {
    const tx = makeTx({ txid: "a".repeat(64) });
    const nodes = new Map<string, GraphNode>([
      ["a".repeat(64), { txid: "a".repeat(64), tx, depth: 0 }],
    ]);
    expect(detectToxicMerges(nodes)).toEqual([]);
  });

  it("detects merge of CoinJoin mixed + change outputs", () => {
    // Whirlpool-like: 5 inputs, 5 equal outputs at 100k + 1 change
    const cjTx = makeTx({
      txid: "cj".padEnd(64, "0"),
      vin: [makeVin(), makeVin(), makeVin(), makeVin(), makeVin()],
      vout: [
        makeVout({ value: 100000 }), // equal (mixed) - index 0
        makeVout({ value: 100000 }), // equal (mixed) - index 1
        makeVout({ value: 100000 }), // equal (mixed) - index 2
        makeVout({ value: 100000 }), // equal (mixed) - index 3
        makeVout({ value: 100000 }), // equal (mixed) - index 4
        makeVout({ value: 50000 }),  // change - index 5
      ],
    });

    // Merge tx spends both a mixed output (index 0) and the change (index 5) from the CoinJoin
    const mergeTx = makeTx({
      txid: "merge".padEnd(64, "0"),
      vin: [
        makeVin({ txid: "cj".padEnd(64, "0"), vout: 0 }), // mixed output
        makeVin({ txid: "cj".padEnd(64, "0"), vout: 5 }), // change output
      ],
      vout: [makeVout({ value: 248000 })],
    });

    const nodes = new Map<string, GraphNode>([
      ["cj".padEnd(64, "0"), { txid: "cj".padEnd(64, "0"), tx: cjTx, depth: 0 }],
      ["merge".padEnd(64, "0"), { txid: "merge".padEnd(64, "0"), tx: mergeTx, depth: 1, parentEdge: { fromTxid: "cj".padEnd(64, "0"), outputIndex: 0 } }],
    ]);

    const merges = detectToxicMerges(nodes);
    expect(merges.length).toBe(1);
    expect(merges[0].mergeTxid).toBe("merge".padEnd(64, "0"));
    expect(merges[0].coinjoinTxid).toBe("cj".padEnd(64, "0"));
    expect(merges[0].mixedOutputIndex).toBe(0);
    expect(merges[0].changeOutputIndex).toBe(5);
  });

  it("does not flag when mixed outputs are spent separately", () => {
    const cjTx = makeTx({
      txid: "cj2".padEnd(64, "0"),
      vin: [makeVin(), makeVin(), makeVin(), makeVin(), makeVin()],
      vout: [
        makeVout({ value: 100000 }),
        makeVout({ value: 100000 }),
        makeVout({ value: 100000 }),
        makeVout({ value: 100000 }),
        makeVout({ value: 100000 }),
        makeVout({ value: 50000 }),
      ],
    });

    // Spend mixed output 0 in one tx, change in a different tx
    const spendMixed = makeTx({
      txid: "sm".padEnd(64, "0"),
      vin: [makeVin({ txid: "cj2".padEnd(64, "0"), vout: 0 })],
      vout: [makeVout({ value: 98000 })],
    });
    const spendChange = makeTx({
      txid: "sc".padEnd(64, "0"),
      vin: [makeVin({ txid: "cj2".padEnd(64, "0"), vout: 5 })],
      vout: [makeVout({ value: 48000 })],
    });

    const nodes = new Map<string, GraphNode>([
      ["cj2".padEnd(64, "0"), { txid: "cj2".padEnd(64, "0"), tx: cjTx, depth: 0 }],
      ["sm".padEnd(64, "0"), { txid: "sm".padEnd(64, "0"), tx: spendMixed, depth: 1 }],
      ["sc".padEnd(64, "0"), { txid: "sc".padEnd(64, "0"), tx: spendChange, depth: 1 }],
    ]);

    expect(detectToxicMerges(nodes)).toEqual([]);
  });
});
