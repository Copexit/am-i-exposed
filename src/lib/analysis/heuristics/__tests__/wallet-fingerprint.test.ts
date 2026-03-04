import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWalletFingerprint } from "../wallet-fingerprint";
import { makeTx, makeVin, makeCoinbaseVin, makeVout, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

describe("analyzeWalletFingerprint", () => {
  it("detects nLockTime as block height -> Bitcoin Core / Sparrow, impact -3", () => {
    const tx = makeTx({ locktime: 800_000 });
    const { findings } = analyzeWalletFingerprint(tx);
    const f = findings.find((f) => f.id === "h11-wallet-fingerprint");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-3);
    expect(f!.severity).toBe("low");
    expect(f!.params?.walletGuess).toBe("Bitcoin Core / Sparrow");
  });

  it("detects BIP69 + allMax + locktime=0 -> Ashigaru/Samourai, impact -6", () => {
    // BIP69 + nSequence=0xffffffff + locktime=0 is the Ashigaru/Samourai pattern
    const tx = makeTx({
      locktime: 0,
      vin: [
        makeVin({ txid: "a".repeat(64), vout: 0, sequence: 0xffffffff }),
        makeVin({ txid: "b".repeat(64), vout: 0, sequence: 0xffffffff }),
        makeVin({ txid: "c".repeat(64), vout: 0, sequence: 0xffffffff }),
      ],
      vout: [
        makeVout({ value: 10_000, scriptpubkey: "0014" + "a".repeat(40) }),
        makeVout({ value: 20_000, scriptpubkey: "0014" + "b".repeat(40) }),
        makeVout({ value: 30_000, scriptpubkey: "0014" + "c".repeat(40) }),
      ],
    });
    const { findings } = analyzeWalletFingerprint(tx);
    const f = findings.find((f) => f.id === "h11-wallet-fingerprint");
    expect(f).toBeDefined();
    expect(f!.params?.walletGuess).toBe("Ashigaru/Samourai");
    expect(f!.scoreImpact).toBe(-6);
  });

  it("detects BIP69 + non-legacy sequence -> Electrum, impact -6", () => {
    // BIP69 with RBF sequence (0xfffffffd) and locktime=0 falls through to Electrum
    // (the Samourai branch requires allMax=true i.e. 0xffffffff)
    const tx = makeTx({
      locktime: 0,
      vin: [
        makeVin({ txid: "a".repeat(64), vout: 0, sequence: 0xfffffffd }),
        makeVin({ txid: "b".repeat(64), vout: 0, sequence: 0xfffffffd }),
        makeVin({ txid: "c".repeat(64), vout: 0, sequence: 0xfffffffd }),
      ],
      vout: [
        makeVout({ value: 10_000, scriptpubkey: "0014" + "a".repeat(40) }),
        makeVout({ value: 20_000, scriptpubkey: "0014" + "b".repeat(40) }),
        makeVout({ value: 30_000, scriptpubkey: "0014" + "c".repeat(40) }),
      ],
    });
    const { findings } = analyzeWalletFingerprint(tx);
    const f = findings.find((f) => f.id === "h11-wallet-fingerprint");
    expect(f).toBeDefined();
    expect(f!.params?.walletGuess).toBe("Electrum (or BIP69-compatible)");
    expect(f!.scoreImpact).toBe(-6);
  });

  it("detects Low-R signatures from rawHex -> Bitcoin Core, impact -3", () => {
    // Build a rawHex with DER sigs where R-length = 0x20 (32 bytes) for all inputs
    // DER: 30 [total-len] 02 20 [32-byte-R] 02 [slen] [S]
    const rBytes = "00".repeat(32);
    const sBytes = "00".repeat(32);
    const sig = `3044022020${rBytes}0220${sBytes}`;
    const rawHex = sig + sig; // two sigs for two inputs
    const tx = makeTx({
      locktime: 0,
      vin: [
        makeVin({ sequence: 0xffffffff }),
        makeVin({ sequence: 0xffffffff }),
      ],
    });
    const { findings } = analyzeWalletFingerprint(tx, rawHex);
    const f = findings.find((f) => f.id === "h11-wallet-fingerprint");
    expect(f).toBeDefined();
    expect(f!.params?.walletGuess).toBe("Bitcoin Core");
    expect(f!.scoreImpact).toBe(-3);
  });

  it.skip("returns impact -4 for 3+ signals without wallet guess (hard to trigger: BIP69/nLockTime always assign a guess)", () => {
    // This code path exists but every combination of 3+ signals
    // includes one that assigns a walletGuess, making it unreachable.
  });

  it("returns impact -2 for single nSequence signal (no wallet guess)", () => {
    // nSequence = 0xfffffffe on all inputs, no nLockTime signal, < 3 in/out (no BIP69 check)
    const tx = makeTx({
      locktime: 0,
      vin: [makeVin({ sequence: 0xfffffffe }), makeVin({ sequence: 0xfffffffe })],
      vout: [makeVout()],
    });
    const { findings } = analyzeWalletFingerprint(tx);
    const f = findings.find((f) => f.id === "h11-wallet-fingerprint");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-2);
    expect(f!.params?.walletGuess).toBeUndefined();
  });

  it("returns empty when no signals detected", () => {
    // nSequence=0xffffffff IS a signal ("legacy, no locktime/RBF")
    // To get no signals: need non-standard sequence that doesn't match any pattern
    const tx2 = makeTx({
      locktime: 0,
      vin: [
        makeVin({ sequence: 0xfffffffc }),
        makeVin({ sequence: 0xfffffffd }),
      ],
      vout: [makeVout()],
    });
    const { findings } = analyzeWalletFingerprint(tx2);
    // Mixed sequences don't trigger any single pattern
    expect(findings).toHaveLength(0);
  });

  it("skips coinbase transactions", () => {
    const tx = makeTx({
      locktime: 800_000,
      vin: [makeCoinbaseVin()],
      vout: [makeVout({ value: 625_000_000 })],
    });
    const { findings } = analyzeWalletFingerprint(tx);
    expect(findings).toHaveLength(0);
  });
});
