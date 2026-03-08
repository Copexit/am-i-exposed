import { describe, it, expect, beforeEach } from "vitest";
import { analyzeFingerprintEvolution } from "../prospective";
import { makeTx, makeVin, resetAddrCounter } from "../../heuristics/__tests__/fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

const ADDR = "bc1qsender00000000000000000000000000000001";

function makeSenderTx(overrides: {
  txid?: string;
  version?: number;
  locktime?: number;
  blockHeight?: number;
  blockTime?: number;
  scriptpubkeyType?: string;
  sequence?: number;
}) {
  return makeTx({
    txid: overrides.txid ?? Math.random().toString(16).slice(2).padEnd(64, "0"),
    version: overrides.version ?? 2,
    locktime: overrides.locktime ?? (overrides.blockHeight ?? 800000),
    vin: [
      makeVin({
        prevout: {
          scriptpubkey: "0014" + "aa".repeat(20),
          scriptpubkey_asm: "",
          scriptpubkey_type: overrides.scriptpubkeyType ?? "v0_p2wpkh",
          scriptpubkey_address: ADDR,
          value: 100_000,
        },
        sequence: overrides.sequence ?? 0xfffffffd,
      }),
    ],
    status: {
      confirmed: true,
      block_height: overrides.blockHeight ?? 800000,
      block_time: overrides.blockTime ?? 1700000000,
    },
  });
}

describe("analyzeFingerprintEvolution", () => {
  it("returns empty for fewer than 2 sender txs", () => {
    const txs = [makeSenderTx({ blockTime: 1700000000 })];
    const result = analyzeFingerprintEvolution(ADDR, txs);
    expect(result.snapshots).toHaveLength(0);
    expect(result.findings).toHaveLength(0);
  });

  it("detects nVersion change (wallet migration signal)", () => {
    const txs = [
      makeSenderTx({
        txid: "a".repeat(64),
        version: 1,
        locktime: 0,
        blockTime: 1700000000,
        blockHeight: 800000,
      }),
      makeSenderTx({
        txid: "b".repeat(64),
        version: 2,
        locktime: 800100,
        blockTime: 1700060000,
        blockHeight: 800100,
      }),
    ];
    const result = analyzeFingerprintEvolution(ADDR, txs);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0].changes).toContain("nVersion 1 -> 2");
    // nVersion + locktime change = 2 signals = wallet migration
    const f = result.findings.find((f) => f.id === "prospective-wallet-migration");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("high");
    expect(f!.scoreImpact).toBe(-4);
  });

  it("detects locktime behavior change alone as fingerprint change", () => {
    const txs = [
      makeSenderTx({
        txid: "a".repeat(64),
        version: 2,
        locktime: 0,
        blockTime: 1700000000,
        blockHeight: 800000,
      }),
      makeSenderTx({
        txid: "b".repeat(64),
        version: 2,
        locktime: 800100,
        blockTime: 1700060000,
        blockHeight: 800100,
      }),
    ];
    const result = analyzeFingerprintEvolution(ADDR, txs);
    expect(result.transitions).toHaveLength(1);
    // Single change signal = fingerprint change
    const f = result.findings.find((f) => f.id === "prospective-fingerprint-change");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-1);
  });

  it("detects script type migration", () => {
    const txs = [
      makeSenderTx({
        txid: "a".repeat(64),
        scriptpubkeyType: "v0_p2wpkh",
        blockTime: 1700000000,
        blockHeight: 800000,
      }),
      makeSenderTx({
        txid: "b".repeat(64),
        scriptpubkeyType: "v1_p2tr",
        blockTime: 1700060000,
        blockHeight: 800100,
      }),
    ];
    const result = analyzeFingerprintEvolution(ADDR, txs);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0].changes.some((c) => c.includes("Script type"))).toBe(true);
  });

  it("detects multiple transitions as mixed fingerprints", () => {
    const txs = [
      makeSenderTx({
        txid: "1".repeat(64),
        locktime: 0,
        blockTime: 1700000000,
        blockHeight: 800000,
      }),
      makeSenderTx({
        txid: "2".repeat(64),
        locktime: 800050,
        blockTime: 1700030000,
        blockHeight: 800050,
      }),
      makeSenderTx({
        txid: "3".repeat(64),
        locktime: 0,
        blockTime: 1700060000,
        blockHeight: 800100,
      }),
    ];
    const result = analyzeFingerprintEvolution(ADDR, txs);
    expect(result.transitions.length).toBeGreaterThanOrEqual(2);
    const f = result.findings.find((f) => f.id === "prospective-mixed-fingerprints");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-2);
  });

  it("returns empty when no fingerprint changes", () => {
    const txs = [
      makeSenderTx({
        txid: "a".repeat(64),
        version: 2,
        locktime: 800000,
        blockTime: 1700000000,
        blockHeight: 800000,
      }),
      makeSenderTx({
        txid: "b".repeat(64),
        version: 2,
        locktime: 800100,
        blockTime: 1700060000,
        blockHeight: 800100,
      }),
    ];
    const result = analyzeFingerprintEvolution(ADDR, txs);
    expect(result.transitions).toHaveLength(0);
    expect(result.findings).toHaveLength(0);
  });

  it("detects script diversity across all snapshots", () => {
    const txs = [
      makeSenderTx({
        txid: "1".repeat(64),
        scriptpubkeyType: "p2pkh",
        blockTime: 1700000000,
        blockHeight: 800000,
      }),
      makeSenderTx({
        txid: "2".repeat(64),
        scriptpubkeyType: "v0_p2wpkh",
        blockTime: 1700030000,
        blockHeight: 800050,
      }),
      makeSenderTx({
        txid: "3".repeat(64),
        scriptpubkeyType: "v1_p2tr",
        blockTime: 1700060000,
        blockHeight: 800100,
      }),
    ];
    const result = analyzeFingerprintEvolution(ADDR, txs);
    const f = result.findings.find((f) => f.id === "prospective-script-diversity");
    expect(f).toBeDefined();
    expect(f!.params?.scriptTypeCount).toBe(3);
  });

  it("ignores txs where address is not a sender", () => {
    // Tx where ADDR is only in outputs, not inputs
    const txNotSender = makeTx({
      txid: "c".repeat(64),
      status: { confirmed: true, block_height: 800000, block_time: 1700000000 },
    });
    // Only one sender tx
    const txSender = makeSenderTx({
      txid: "d".repeat(64),
      blockTime: 1700060000,
      blockHeight: 800100,
    });
    const result = analyzeFingerprintEvolution(ADDR, [txNotSender, txSender]);
    expect(result.snapshots).toHaveLength(0); // Only 1 sender tx = not enough
  });
});
