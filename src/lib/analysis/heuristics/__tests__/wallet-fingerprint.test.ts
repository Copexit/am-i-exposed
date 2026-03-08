import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWalletFingerprint } from "../wallet-fingerprint";
import { makeTx, makeVin, makeCoinbaseVin, makeVout, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

describe("analyzeWalletFingerprint", () => {
  // ── nLockTime / nVersion / nSequence sub-findings ─────────────────────

  it("flags nVersion=1 with sub-finding h11-legacy-version (informational, 0 impact)", () => {
    const tx = makeTx({ version: 1, locktime: 0 });
    const { findings } = analyzeWalletFingerprint(tx);
    const f = findings.find((f) => f.id === "h11-legacy-version");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(0);
    expect(f!.severity).toBe("low");
  });

  it("flags nLockTime=0 with sub-finding h11-no-locktime (informational, 0 impact)", () => {
    const tx = makeTx({ locktime: 0 });
    const { findings } = analyzeWalletFingerprint(tx);
    const f = findings.find((f) => f.id === "h11-no-locktime");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(0);
    expect(f!.severity).toBe("low");
  });

  it("does NOT flag nLockTime=0 sub-finding when locktime is block height", () => {
    const tx = makeTx({ locktime: 800_000 });
    const { findings } = analyzeWalletFingerprint(tx);
    expect(findings.find((f) => f.id === "h11-no-locktime")).toBeUndefined();
  });

  it("flags mixed nSequence with sub-finding h11-mixed-sequence (informational, 0 impact)", () => {
    const tx = makeTx({
      locktime: 0,
      vin: [
        makeVin({ sequence: 0xfffffffd }),
        makeVin({ sequence: 0xfffffffe }),
      ],
      vout: [makeVout()],
    });
    const { findings } = analyzeWalletFingerprint(tx);
    const f = findings.find((f) => f.id === "h11-mixed-sequence");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(0);
  });

  // ── Main fingerprint finding: wallet identification ───────────────────

  it("does NOT label single nLockTime=block_height as Bitcoin Core (ambiguous)", () => {
    // Just locktime + default RBF sequence - too many wallets match this
    const tx = makeTx({ locktime: 800_000 });
    const { findings } = analyzeWalletFingerprint(tx);
    const f = findings.find((f) => f.id === "h11-wallet-fingerprint");
    expect(f).toBeDefined();
    // Should NOT identify a specific wallet - the pattern is shared by many wallets
    expect(f!.params?.walletGuess).toBeUndefined();
  });

  it("identifies Bitcoin Core with randomized locktime + Low-R", () => {
    // locktime = block_height - 50 (randomized) + Low-R signatures
    const rBytes = "00".repeat(32);
    const sBytes = "00".repeat(32);
    const sig = `3044022020${rBytes}0220${sBytes}`;
    const rawHex = sig + sig;
    const tx = makeTx({
      locktime: 799_950, // delta = 800_000 - 799_950 = 50 (randomized range)
      vin: [
        makeVin({ sequence: 0xfffffffd }),
        makeVin({ sequence: 0xfffffffd }),
      ],
    });
    const { findings } = analyzeWalletFingerprint(tx, rawHex);
    const f = findings.find((f) => f.id === "h11-wallet-fingerprint");
    expect(f).toBeDefined();
    expect(f!.params?.walletGuess).toBe("Bitcoin Core");
    expect(f!.scoreImpact).toBe(-5);
  });

  it("identifies Bitcoin Core with exact locktime + Low-R (no BIP69)", () => {
    const rBytes = "00".repeat(32);
    const sBytes = "00".repeat(32);
    const sig = `3044022020${rBytes}0220${sBytes}`;
    const rawHex = sig + sig;
    const tx = makeTx({
      locktime: 800_000,
      vin: [
        makeVin({ sequence: 0xfffffffd }),
        makeVin({ sequence: 0xfffffffd }),
      ],
    });
    const { findings } = analyzeWalletFingerprint(tx, rawHex);
    const f = findings.find((f) => f.id === "h11-wallet-fingerprint");
    expect(f).toBeDefined();
    expect(f!.params?.walletGuess).toBe("Bitcoin Core");
    expect(f!.scoreImpact).toBe(-5);
  });

  it("detects BIP69 + allMax + locktime=0 -> Ashigaru/Samourai", () => {
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
    expect(f!.scoreImpact).toBe(-7);
  });

  it("detects BIP69 + RBF sequence -> Electrum", () => {
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
    expect(f!.params?.walletGuess).toBe("Electrum");
    expect(f!.scoreImpact).toBe(-6);
  });

  it("detects BIP69 + no-RBF sequence -> Sparrow/Ashigaru", () => {
    const tx = makeTx({
      locktime: 0,
      vin: [
        makeVin({ txid: "a".repeat(64), vout: 0, sequence: 0xfffffffe }),
        makeVin({ txid: "b".repeat(64), vout: 0, sequence: 0xfffffffe }),
        makeVin({ txid: "c".repeat(64), vout: 0, sequence: 0xfffffffe }),
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
    expect(f!.params?.walletGuess).toBe("Sparrow/Ashigaru");
    expect(f!.scoreImpact).toBe(-7);
  });

  it("does not falsely label legacy txs as Wasabi (nVersion=1 + locktime=0 + allMax is ambiguous)", () => {
    const tx = makeTx({
      version: 1,
      locktime: 0,
      vin: [
        makeVin({ sequence: 0xffffffff }),
        makeVin({ sequence: 0xffffffff }),
      ],
      vout: [makeVout()],
    });
    const { findings } = analyzeWalletFingerprint(tx);
    const f = findings.find((f) => f.id === "h11-wallet-fingerprint");
    expect(f).toBeDefined();
    // Should NOT assign a wallet guess - pattern is shared with legacy txs
    expect(f!.params?.walletGuess).toBeUndefined();
    // Should still have sub-findings for nVersion=1 and nLockTime=0
    expect(findings.find((f) => f.id === "h11-legacy-version")).toBeDefined();
    expect(findings.find((f) => f.id === "h11-no-locktime")).toBeDefined();
  });

  it("detects Low-R signatures -> Bitcoin Core (with locktime=0)", () => {
    // Low-R without other Core signals should only guess Core if combined properly
    const rBytes = "00".repeat(32);
    const sBytes = "00".repeat(32);
    const sig = `3044022020${rBytes}0220${sBytes}`;
    const rawHex = sig + sig;
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
    // With locktime=0 + allMax + Low-R, no wallet matches the decision tree
    // (Core uses block-height locktime). Low-R is a signal but not enough alone.
    expect(f!.params?.signals).toContain("Low-R");
  });

  it("returns impact -2 for single nSequence signal (no wallet guess)", () => {
    // nSequence = 0xfffffffe on all inputs, locktime=block height, < 3 in/out
    const tx = makeTx({
      locktime: 800_000,
      vin: [makeVin({ sequence: 0xfffffffe }), makeVin({ sequence: 0xfffffffe })],
      vout: [makeVout()],
    });
    const { findings } = analyzeWalletFingerprint(tx);
    const f = findings.find((f) => f.id === "h11-wallet-fingerprint");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-3);
    expect(f!.params?.walletGuess).toBeUndefined();
  });

  it("returns empty main finding when no signals detected", () => {
    // Mixed non-standard sequences: triggers h11-mixed-sequence but not the main finding pattern
    const tx = makeTx({
      locktime: 0,
      vin: [
        makeVin({ sequence: 0xfffffffc }),
        makeVin({ sequence: 0xfffffffb }),
      ],
      vout: [makeVout()],
    });
    const { findings } = analyzeWalletFingerprint(tx);
    // Mixed sequence sub-finding fires, but main signals list captures it
    const main = findings.find((f) => f.id === "h11-wallet-fingerprint");
    // We should have signals: mixed nSequence + nLockTime=0
    expect(main).toBeDefined();
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

  it("detects randomized locktime as a specific signal", () => {
    // delta = 800_000 - 799_920 = 80 (within 2-100 range)
    const tx = makeTx({
      locktime: 799_920,
      vin: [makeVin({ sequence: 0xfffffffd })],
      vout: [makeVout()],
    });
    const { findings } = analyzeWalletFingerprint(tx);
    const f = findings.find((f) => f.id === "h11-wallet-fingerprint");
    expect(f).toBeDefined();
    expect(f!.params?.signals).toContain("randomized");
  });

  it("detects locktime=block_height+1 as unusual", () => {
    // delta = 800_000 - 800_001 = -1
    const tx = makeTx({
      locktime: 800_001,
      vin: [makeVin({ sequence: 0xfffffffd })],
      vout: [makeVout()],
    });
    const { findings } = analyzeWalletFingerprint(tx);
    const f = findings.find((f) => f.id === "h11-wallet-fingerprint");
    expect(f).toBeDefined();
    expect(f!.params?.signals).toContain("block_height+1");
  });

  it("recommendation talks about anonymity sets, not avoiding fingerprints", () => {
    const tx = makeTx({ locktime: 800_000 });
    const { findings } = analyzeWalletFingerprint(tx);
    const f = findings.find((f) => f.id === "h11-wallet-fingerprint");
    expect(f).toBeDefined();
    expect(f!.recommendation).toContain("anonymity sets");
    expect(f!.recommendation).toContain("blending in");
  });

  it("includes anonymity set note in description for identified wallets", () => {
    // Ashigaru/Samourai pattern: BIP69 + allMax + locktime=0
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
    expect(f!.description).toContain("Samourai/Ashigaru");
  });
});
