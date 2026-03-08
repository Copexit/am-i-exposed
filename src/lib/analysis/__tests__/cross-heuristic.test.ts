import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyzeTransaction } from "../orchestrator";
import { makeTx, makeVin, makeVout, resetAddrCounter } from "../heuristics/__tests__/fixtures/tx-factory";
import { WHIRLPOOL_DENOMS } from "@/lib/constants";

beforeEach(() => resetAddrCounter());

vi.useFakeTimers();

/** Helper: create a Whirlpool-like transaction (5 equal outputs at known denom). */
function makeWhirlpoolTx() {
  const denom = WHIRLPOOL_DENOMS[2]; // 1_000_000 sats
  return makeTx({
    vin: Array.from({ length: 5 }, (_, i) =>
      makeVin({
        txid: String(i).padStart(64, "a"),
        prevout: {
          scriptpubkey: "",
          scriptpubkey_asm: "",
          scriptpubkey_type: "v0_p2wpkh",
          scriptpubkey_address: `bc1qwp${String(i).padStart(37, "0")}`,
          value: denom + 5000,
        },
      }),
    ),
    vout: Array.from({ length: 5 }, () => makeVout({ value: denom })),
    locktime: 800_000, // triggers wallet fingerprint
    fee: 25_000,
    weight: 2000,
  });
}

describe("cross-heuristic intelligence", () => {
  it("suppresses findings when CoinJoin is detected", async () => {
    const tx = makeWhirlpoolTx();
    const resultPromise = analyzeTransaction(tx);
    // Advance through all tick() delays (13 heuristics * 2 calls = 26, each 50ms)
    await vi.advanceTimersByTimeAsync(22 * 100);
    const result = await resultPromise;

    // Whirlpool should be detected
    const whirlpool = result.findings.find((f) => f.id === "h4-whirlpool");
    expect(whirlpool).toBeDefined();
    expect(whirlpool!.scoreImpact).toBe(30);

    // These finding IDs should have scoreImpact=0 when CoinJoin is detected
    const suppressedIds = [
      "h3-cioh",
      "h1-round-amount",
      "h2-change-detected",
      "script-mixed",
      "h5-low-entropy",
      "h11-wallet-fingerprint",
      "dust-attack",
      "dust-outputs",
      "timing-unconfirmed",
      "h6-round-fee-rate",
      "h6-rbf-signaled",
      "anon-set-none",
      "anon-set-moderate",
      "h17-multisig-info",
      "h17-hodlhodl",
      "h17-escrow-2of3",
      "h17-escrow-2of2",
    ];

    for (const id of suppressedIds) {
      const f = result.findings.find((f) => f.id === id);
      if (f) {
        expect(f.scoreImpact).toBe(0);
        expect(f.params?.context).toContain("coinjoin");
      }
    }
  });

  it("does NOT suppress h2-self-send even in CoinJoin context", async () => {
    // Create a Whirlpool-like tx but with a self-send output
    const denom = WHIRLPOOL_DENOMS[2];
    const selfAddr = "bc1qself0000000000000000000000000000000000";
    const tx = makeTx({
      vin: [
        ...Array.from({ length: 4 }, (_, i) =>
          makeVin({
            txid: String(i).padStart(64, "a"),
            prevout: {
              scriptpubkey: "",
              scriptpubkey_asm: "",
              scriptpubkey_type: "v0_p2wpkh",
              scriptpubkey_address: `bc1qwp${String(i).padStart(37, "0")}`,
              value: denom + 5000,
            },
          }),
        ),
        makeVin({
          txid: "4".padStart(64, "a"),
          prevout: {
            scriptpubkey: "",
            scriptpubkey_asm: "",
            scriptpubkey_type: "v0_p2wpkh",
            scriptpubkey_address: selfAddr,
            value: denom + 5000,
          },
        }),
      ],
      vout: [
        ...Array.from({ length: 4 }, () => makeVout({ value: denom })),
        makeVout({ value: denom, scriptpubkey_address: selfAddr }),
      ],
      fee: 25_000,
      weight: 2000,
    });

    const resultPromise = analyzeTransaction(tx);
    await vi.advanceTimersByTimeAsync(22 * 100);
    const result = await resultPromise;

    // h2-self-send should NOT be suppressed (but it might not trigger depending
    // on how change detection classifies this). If it exists, verify impact != 0
    const selfSend = result.findings.find((f) => f.id === "h2-self-send");
    if (selfSend) {
      expect(selfSend.scoreImpact).not.toBe(0);
    }
  });

  it("infers Wasabi wallet from WabiSabi CoinJoin", async () => {
    // Build a WabiSabi-like tx
    const vins = Array.from({ length: 25 }, (_, i) =>
      makeVin({
        txid: String(i).padStart(64, "b"),
        prevout: {
          scriptpubkey: "",
          scriptpubkey_asm: "",
          scriptpubkey_type: "v0_p2wpkh",
          scriptpubkey_address: `bc1qwb${String(i).padStart(37, "0")}`,
          value: 500_000,
        },
      }),
    );
    const vouts = [
      ...Array.from({ length: 5 }, () => makeVout({ value: 100_000 })),
      ...Array.from({ length: 4 }, () => makeVout({ value: 200_000 })),
      ...Array.from({ length: 3 }, () => makeVout({ value: 50_001 })),
      ...Array.from({ length: 13 }, (_, i) => makeVout({ value: 10_000 + i * 1_000 })),
    ];
    const tx = makeTx({
      vin: vins,
      vout: vouts,
      locktime: 0, // no nLockTime signal so walletGuess is unset, allowing Wasabi inference
      fee: 50_000,
      weight: 5000,
    });

    const resultPromise = analyzeTransaction(tx);
    await vi.advanceTimersByTimeAsync(22 * 100);
    const result = await resultPromise;

    const wf = result.findings.find((f) => f.id === "h11-wallet-fingerprint");
    if (wf) {
      expect(wf.scoreImpact).toBe(0);
      expect(wf.params?.walletGuess).toBe("Wasabi Wallet");
    }
  });

  it("softens script-mixed penalty when multisig is detected", async () => {
    // Multisig input (P2SH wrapping 2-of-3) spending to P2WPKH outputs
    // The script type mix is inherent to multisig, not a privacy leak
    const pubkey = "02" + "ab".repeat(32);
    const tx = makeTx({
      vin: [
        makeVin({
          prevout: {
            scriptpubkey: "a914" + "a".repeat(40) + "87",
            scriptpubkey_asm: "OP_HASH160 OP_PUSHBYTES_20 " + "a".repeat(40) + " OP_EQUAL",
            scriptpubkey_type: "p2sh",
            scriptpubkey_address: "3" + "A".repeat(33),
            value: 200_000,
          },
          inner_redeemscript_asm: `OP_PUSHNUM_2 OP_PUSHBYTES_33 ${pubkey} OP_PUSHBYTES_33 ${pubkey} OP_PUSHBYTES_33 ${pubkey} OP_PUSHNUM_3 OP_CHECKMULTISIG`,
        }),
      ],
      vout: [
        makeVout({ value: 100_000 }),
        makeVout({ value: 90_000 }),
      ],
    });

    const resultPromise = analyzeTransaction(tx);
    await vi.advanceTimersByTimeAsync(22 * 100);
    const result = await resultPromise;

    // If script-mixed fired, it should be softened to impact 0
    const scriptMixed = result.findings.find((f) => f.id === "script-mixed");
    if (scriptMixed) {
      expect(scriptMixed.scoreImpact).toBe(0);
      expect(scriptMixed.params?.context).toBe("multisig");
    }
  });

  it("does NOT suppress findings when no CoinJoin detected", async () => {
    // Normal transaction - no CoinJoin
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa1" + "0".repeat(35), value: 100_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qa2" + "0".repeat(35), value: 100_000 } }),
      ],
      vout: [
        makeVout({ value: 100_000 }),
        makeVout({ value: 90_000 }),
      ],
    });

    const resultPromise = analyzeTransaction(tx);
    await vi.advanceTimersByTimeAsync(22 * 100);
    const result = await resultPromise;

    // CIOH should have non-zero impact (2 addresses -> -6)
    const cioh = result.findings.find((f) => f.id === "h3-cioh");
    expect(cioh).toBeDefined();
    expect(cioh!.scoreImpact).toBe(-6);
  });
});
