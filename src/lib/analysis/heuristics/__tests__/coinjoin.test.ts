import { describe, it, expect, beforeEach } from "vitest";
import { analyzeCoinJoin, isCoinJoinFinding } from "../coinjoin";
import { makeTx, makeVin, makeVout, resetAddrCounter } from "./fixtures/tx-factory";
import { WHIRLPOOL_DENOMS } from "@/lib/constants";

beforeEach(() => resetAddrCounter());

/** Helper: create N vins with unique txids (for BIP69 / distinct inputs). */
function makeDistinctVins(n: number) {
  return Array.from({ length: n }, (_, i) =>
    makeVin({
      txid: String(i).padStart(64, "a"),
      prevout: {
        scriptpubkey: "",
        scriptpubkey_asm: "",
        scriptpubkey_type: "v0_p2wpkh",
        scriptpubkey_address: `bc1qcj${String(i).padStart(36, "0")}`,
        value: 1_000_000,
      },
    }),
  );
}

describe("analyzeCoinJoin", () => {
  // ── Whirlpool ────────────────────────────────────────────────────────

  it("detects Whirlpool (5 equal outputs at known denom), impact +30", () => {
    const denom = WHIRLPOOL_DENOMS[2]; // 1_000_000 sats
    const tx = makeTx({
      vin: makeDistinctVins(5),
      vout: Array.from({ length: 5 }, () => makeVout({ value: denom })),
    });
    const { findings } = analyzeCoinJoin(tx);
    // Whirlpool returns early - only 1 finding, no exchange-flagging
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h4-whirlpool");
    expect(findings[0].scoreImpact).toBe(30);
    expect(findings[0].severity).toBe("good");
  });

  it("does not detect Whirlpool with only 4 equal outputs", () => {
    const denom = WHIRLPOOL_DENOMS[0]; // 50_000 sats
    const tx = makeTx({
      vin: makeDistinctVins(4),
      vout: [
        ...Array.from({ length: 4 }, () => makeVout({ value: denom })),
        makeVout({ value: 30_000 }),
      ],
    });
    const { findings } = analyzeCoinJoin(tx);
    expect(findings.find((f) => f.id === "h4-whirlpool")).toBeUndefined();
  });

  it("detects Whirlpool with 5 equal + 1 extra output (up to 6 total)", () => {
    const denom = WHIRLPOOL_DENOMS[1]; // 100_000 sats
    const tx = makeTx({
      vin: makeDistinctVins(5),
      vout: [
        ...Array.from({ length: 5 }, () => makeVout({ value: denom })),
        makeVout({ value: 5_000 }), // small change/fee output
      ],
    });
    const { findings } = analyzeCoinJoin(tx);
    expect(findings[0].id).toBe("h4-whirlpool");
    expect(findings[0].scoreImpact).toBe(30);
  });

  it("detects Whirlpool 8x8 (8 equal outputs at known denom)", () => {
    const denom = WHIRLPOOL_DENOMS[2]; // 1_000_000 sats
    const tx = makeTx({
      vin: makeDistinctVins(8),
      vout: Array.from({ length: 8 }, () => makeVout({ value: denom })),
    });
    const { findings } = analyzeCoinJoin(tx);
    expect(findings[0].id).toBe("h4-whirlpool");
    expect(findings[0].scoreImpact).toBe(30);
  });

  it("detects Whirlpool 9x9 (9 equal outputs at known denom)", () => {
    const denom = WHIRLPOOL_DENOMS[0]; // 50_000 sats
    const tx = makeTx({
      vin: makeDistinctVins(9),
      vout: Array.from({ length: 9 }, () => makeVout({ value: denom })),
    });
    const { findings } = analyzeCoinJoin(tx);
    expect(findings[0].id).toBe("h4-whirlpool");
    expect(findings[0].scoreImpact).toBe(30);
  });

  // ── WabiSabi multi-tier ──────────────────────────────────────────────

  it("detects WabiSabi multi-tier (20+ in/out, 3+ groups, 10+ equal total)", () => {
    // 20 inputs, outputs with multiple denomination tiers
    const vins = makeDistinctVins(25);
    const vouts = [
      // Group 1: 5 equal outputs of 100k
      ...Array.from({ length: 5 }, () => makeVout({ value: 100_000 })),
      // Group 2: 4 equal outputs of 200k
      ...Array.from({ length: 4 }, () => makeVout({ value: 200_000 })),
      // Group 3: 3 equal outputs of 50k
      ...Array.from({ length: 3 }, () => makeVout({ value: 50_001 })), // avoid Whirlpool denom
      // Remaining unique outputs
      ...Array.from({ length: 13 }, (_, i) => makeVout({ value: 10_000 + i * 1_000 })),
    ];
    const tx = makeTx({ vin: vins, vout: vouts });
    const { findings } = analyzeCoinJoin(tx);
    const cj = findings.find((f) => f.id === "h4-coinjoin");
    expect(cj).toBeDefined();
    expect(cj!.params?.isWabiSabi).toBe(1);
    expect(cj!.scoreImpact).toBeGreaterThanOrEqual(20);
    // Should also have exchange-flagging
    expect(findings.find((f) => f.id === "h4-exchange-flagging")).toBeDefined();
  });

  // ── Equal output CoinJoin ────────────────────────────────────────────

  it("detects equal-output CoinJoin with single dominant denomination as JoinMarket, impact +20", () => {
    const tx = makeTx({
      vin: makeDistinctVins(5),
      vout: [
        ...Array.from({ length: 5 }, () => makeVout({ value: 75_000 })),
        makeVout({ value: 10_000 }), // change
      ],
    });
    const { findings } = analyzeCoinJoin(tx);
    // Single dominant denomination (5 equal) + 1 change = JoinMarket pattern
    const jm = findings.find((f) => f.id === "h4-joinmarket");
    expect(jm).toBeDefined();
    expect(jm!.scoreImpact).toBe(20);
    expect(findings.find((f) => f.id === "h4-exchange-flagging")).toBeDefined();
  });

  it("detects large single-denomination CoinJoin as JoinMarket, impact +25", () => {
    const tx = makeTx({
      vin: makeDistinctVins(10),
      vout: [
        ...Array.from({ length: 10 }, () => makeVout({ value: 75_000 })),
        makeVout({ value: 10_000 }),
      ],
    });
    const { findings } = analyzeCoinJoin(tx);
    // Single denomination (10 equal) + 1 change output = JoinMarket pattern
    const jm = findings.find((f) => f.id === "h4-joinmarket");
    expect(jm).toBeDefined();
    expect(jm!.scoreImpact).toBe(25);
  });

  // ── JoinMarket ───────────────────────────────────────────────────────

  it("detects JoinMarket (2-4 equal, distinct addrs, 2-10 vin, 3-8 vout), impact +15", () => {
    // Use 5 outputs to avoid Stonewall pattern (which requires exactly 4 outputs)
    const tx = makeTx({
      vin: makeDistinctVins(4),
      vout: [
        makeVout({ value: 500_000, scriptpubkey_address: "bc1qjm1_0000000000000000000000000000000000" }),
        makeVout({ value: 500_000, scriptpubkey_address: "bc1qjm2_0000000000000000000000000000000000" }),
        makeVout({ value: 300_000 }), // change 1
        makeVout({ value: 200_000 }), // change 2
        makeVout({ value: 100_000 }), // change 3
      ],
    });
    const { findings } = analyzeCoinJoin(tx);
    const jm = findings.find((f) => f.id === "h4-joinmarket");
    expect(jm).toBeDefined();
    expect(jm!.scoreImpact).toBe(15);
    expect(findings.find((f) => f.id === "h4-exchange-flagging")).toBeDefined();
  });

  it("does not detect JoinMarket when equal outputs go to same address", () => {
    const sameAddr = "bc1qsame0000000000000000000000000000000000";
    const tx = makeTx({
      vin: makeDistinctVins(3),
      vout: [
        makeVout({ value: 500_000, scriptpubkey_address: sameAddr }),
        makeVout({ value: 500_000, scriptpubkey_address: sameAddr }),
        makeVout({ value: 300_000 }),
        makeVout({ value: 200_000 }),
      ],
    });
    const { findings } = analyzeCoinJoin(tx);
    expect(findings.find((f) => f.id === "h4-joinmarket")).toBeUndefined();
  });

  // ── Stonewall ────────────────────────────────────────────────────────

  it("detects solo Stonewall (2 vin same addr, 4 vout, 1 equal pair at distinct addrs), impact +8", () => {
    // Use same input address so JoinMarket rejects (requires >= 2 distinct input addrs)
    const sameInputAddr = "bc1qinput000000000000000000000000000000000";
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: sameInputAddr, value: 1_000_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: sameInputAddr, value: 1_000_000 } }),
      ],
      vout: [
        makeVout({ value: 200_000, scriptpubkey_address: "bc1qsw1_0000000000000000000000000000000000" }),
        makeVout({ value: 200_000, scriptpubkey_address: "bc1qsw2_0000000000000000000000000000000000" }),
        makeVout({ value: 150_000 }), // change 1
        makeVout({ value: 100_000 }), // change 2
      ],
    });
    const { findings } = analyzeCoinJoin(tx);
    const sw = findings.find((f) => f.id === "h4-stonewall");
    expect(sw).toBeDefined();
    expect(sw!.scoreImpact).toBe(15);
    // Stonewall is steganographic - no exchange flagging warning
    expect(findings.find((f) => f.id === "h4-exchange-flagging")).toBeUndefined();
  });

  it("does not detect Stonewall when equal pair goes to same address", () => {
    const sameAddr = "bc1qsame0000000000000000000000000000000000";
    const tx = makeTx({
      vin: makeDistinctVins(2),
      vout: [
        makeVout({ value: 200_000, scriptpubkey_address: sameAddr }),
        makeVout({ value: 200_000, scriptpubkey_address: sameAddr }),
        makeVout({ value: 150_000 }),
        makeVout({ value: 100_000 }),
      ],
    });
    const { findings } = analyzeCoinJoin(tx);
    expect(findings.find((f) => f.id === "h4-stonewall")).toBeUndefined();
  });

  it("does not detect Stonewall at Whirlpool denominations", () => {
    const tx = makeTx({
      vin: makeDistinctVins(2),
      vout: [
        makeVout({ value: 100_000, scriptpubkey_address: "bc1qsw1_0000000000000000000000000000000000" }),
        makeVout({ value: 100_000, scriptpubkey_address: "bc1qsw2_0000000000000000000000000000000000" }),
        makeVout({ value: 50_000 }),
        makeVout({ value: 30_000 }),
      ],
    });
    const { findings } = analyzeCoinJoin(tx);
    expect(findings.find((f) => f.id === "h4-stonewall")).toBeUndefined();
  });

  // ── Edge cases ───────────────────────────────────────────────────────

  it("returns empty for < 2 inputs", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [makeVout(), makeVout()],
    });
    const { findings } = analyzeCoinJoin(tx);
    expect(findings).toHaveLength(0);
  });

  it("returns empty for < 2 outputs", () => {
    const tx = makeTx({
      vin: makeDistinctVins(3),
      vout: [makeVout()],
    });
    const { findings } = analyzeCoinJoin(tx);
    expect(findings).toHaveLength(0);
  });

  // ── Boundary tests ──────────────────────────────────────────────────

  it("does not detect equal-output CoinJoin with only 4 equal outputs", () => {
    const tx = makeTx({
      vin: makeDistinctVins(4),
      vout: [
        ...Array.from({ length: 4 }, () => makeVout({ value: 75_000 })),
        makeVout({ value: 10_000 }),
      ],
    });
    const { findings } = analyzeCoinJoin(tx);
    // 4 equal outputs should NOT trigger equal-output CoinJoin (requires 5+)
    expect(findings.find((f) => f.id === "h4-coinjoin")).toBeUndefined();
  });

  it("rejects Whirlpool with 11 outputs at known denom", () => {
    const denom = WHIRLPOOL_DENOMS[2];
    const tx = makeTx({
      vin: makeDistinctVins(11),
      vout: Array.from({ length: 11 }, () => makeVout({ value: denom })),
    });
    const { findings } = analyzeCoinJoin(tx);
    // 11 outputs exceeds the max of 10 for Whirlpool detection
    expect(findings.find((f) => f.id === "h4-whirlpool")).toBeUndefined();
  });

  it("detects Whirlpool with exactly 9 outputs at known denom", () => {
    const denom = WHIRLPOOL_DENOMS[1]; // 100_000 sats
    const tx = makeTx({
      vin: makeDistinctVins(9),
      vout: Array.from({ length: 9 }, () => makeVout({ value: denom })),
    });
    const { findings } = analyzeCoinJoin(tx);
    expect(findings[0].id).toBe("h4-whirlpool");
  });

  it("rejects 10 equal outputs at Whirlpool denom as generic CoinJoin (not Whirlpool)", () => {
    const denom = WHIRLPOOL_DENOMS[1]; // 100_000 sats
    const tx = makeTx({
      vin: makeDistinctVins(10),
      vout: Array.from({ length: 10 }, () => makeVout({ value: denom })),
    });
    const { findings } = analyzeCoinJoin(tx);
    expect(findings.find((f) => f.id === "h4-whirlpool")).toBeUndefined();
    expect(findings[0].id).toBe("h4-coinjoin");
  });

  it("does not detect JoinMarket with 11 inputs", () => {
    const tx = makeTx({
      vin: makeDistinctVins(11),
      vout: [
        makeVout({ value: 500_000, scriptpubkey_address: "bc1qjm1_0000000000000000000000000000000000" }),
        makeVout({ value: 500_000, scriptpubkey_address: "bc1qjm2_0000000000000000000000000000000000" }),
        makeVout({ value: 300_000 }),
      ],
    });
    const { findings } = analyzeCoinJoin(tx);
    expect(findings.find((f) => f.id === "h4-joinmarket")).toBeUndefined();
  });

  it("does not detect JoinMarket with 9 outputs", () => {
    const tx = makeTx({
      vin: makeDistinctVins(4),
      vout: [
        makeVout({ value: 500_000, scriptpubkey_address: "bc1qjm1_0000000000000000000000000000000000" }),
        makeVout({ value: 500_000, scriptpubkey_address: "bc1qjm2_0000000000000000000000000000000000" }),
        ...Array.from({ length: 7 }, (_, i) => makeVout({ value: 100_000 + i * 10_000 })),
      ],
    });
    const { findings } = analyzeCoinJoin(tx);
    expect(findings.find((f) => f.id === "h4-joinmarket")).toBeUndefined();
  });

  it("does not detect JoinMarket with equal outputs below 10k sats", () => {
    const tx = makeTx({
      vin: makeDistinctVins(3),
      vout: [
        makeVout({ value: 9_999, scriptpubkey_address: "bc1qjm1_0000000000000000000000000000000000" }),
        makeVout({ value: 9_999, scriptpubkey_address: "bc1qjm2_0000000000000000000000000000000000" }),
        makeVout({ value: 300_000 }),
        makeVout({ value: 200_000 }),
        makeVout({ value: 100_000 }),
      ],
    });
    const { findings } = analyzeCoinJoin(tx);
    expect(findings.find((f) => f.id === "h4-joinmarket")).toBeUndefined();
  });

  it("detects Stonewall with same-address inputs, impact +15", () => {
    const sameInputAddr = "bc1qinput000000000000000000000000000000000";
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: sameInputAddr, value: 1_000_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: sameInputAddr, value: 500_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: sameInputAddr, value: 500_000 } }),
      ],
      vout: [
        makeVout({ value: 200_000, scriptpubkey_address: "bc1qsw1_0000000000000000000000000000000000" }),
        makeVout({ value: 200_000, scriptpubkey_address: "bc1qsw2_0000000000000000000000000000000000" }),
        makeVout({ value: 150_000 }),
        makeVout({ value: 100_000 }),
      ],
    });
    const { findings } = analyzeCoinJoin(tx);
    const sw = findings.find((f) => f.id === "h4-stonewall");
    expect(sw).toBeDefined();
    expect(sw!.scoreImpact).toBe(15);
  });

  it("detects Stonewall with multi-address inputs (cannot distinguish from STONEWALLx2), impact +15", () => {
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qpartyA_0000000000000000000000000000000", value: 500_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qpartyA_0000000000000000000000000000000", value: 500_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qpartyB_0000000000000000000000000000000", value: 300_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qpartyB_0000000000000000000000000000000", value: 300_000 } }),
      ],
      vout: [
        makeVout({ value: 400_000, scriptpubkey_address: "bc1qsw1_0000000000000000000000000000000000" }),
        makeVout({ value: 400_000, scriptpubkey_address: "bc1qsw2_0000000000000000000000000000000000" }),
        makeVout({ value: 250_000 }),
        makeVout({ value: 200_000 }),
      ],
    });
    const { findings } = analyzeCoinJoin(tx);
    // Both solo and x2 get the same finding - the ambiguity IS the privacy
    const sw = findings.find((f) => f.id === "h4-stonewall");
    expect(sw).toBeDefined();
    expect(sw!.scoreImpact).toBe(15);
  });

  // ── isCoinJoinFinding ────────────────────────────────────────────────

  it("isCoinJoinFinding returns true for positive CoinJoin findings", () => {
    expect(isCoinJoinFinding({ id: "h4-whirlpool", scoreImpact: 30, severity: "good", title: "", description: "", recommendation: "" })).toBe(true);
    expect(isCoinJoinFinding({ id: "h4-coinjoin", scoreImpact: 25, severity: "good", title: "", description: "", recommendation: "" })).toBe(true);
    expect(isCoinJoinFinding({ id: "h4-joinmarket", scoreImpact: 15, severity: "good", title: "", description: "", recommendation: "" })).toBe(true);
    expect(isCoinJoinFinding({ id: "h4-stonewall", scoreImpact: 15, severity: "good", title: "", description: "", recommendation: "" })).toBe(true);
    expect(isCoinJoinFinding({ id: "h4-simplified-stonewall", scoreImpact: 5, severity: "good", title: "", description: "", recommendation: "" })).toBe(true);
  });

  it("isCoinJoinFinding returns false for exchange-flagging (impact 0)", () => {
    expect(isCoinJoinFinding({ id: "h4-exchange-flagging", scoreImpact: 0, severity: "low", title: "", description: "", recommendation: "" })).toBe(false);
  });

  it("isCoinJoinFinding returns false for non-coinjoin findings", () => {
    expect(isCoinJoinFinding({ id: "h3-cioh", scoreImpact: -6, severity: "medium", title: "", description: "", recommendation: "" })).toBe(false);
  });
});
