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

  it("detects equal-output CoinJoin (5+ equal, non-Whirlpool denom), impact +20", () => {
    const tx = makeTx({
      vin: makeDistinctVins(5),
      vout: [
        ...Array.from({ length: 5 }, () => makeVout({ value: 75_000 })),
        makeVout({ value: 10_000 }), // change
      ],
    });
    const { findings } = analyzeCoinJoin(tx);
    const cj = findings.find((f) => f.id === "h4-coinjoin");
    expect(cj).toBeDefined();
    expect(cj!.scoreImpact).toBe(20);
    expect(findings.find((f) => f.id === "h4-exchange-flagging")).toBeDefined();
  });

  it("detects equal-output CoinJoin with 10+ equal outputs, impact +25", () => {
    const tx = makeTx({
      vin: makeDistinctVins(10),
      vout: [
        ...Array.from({ length: 10 }, () => makeVout({ value: 75_000 })),
        makeVout({ value: 10_000 }),
      ],
    });
    const { findings } = analyzeCoinJoin(tx);
    const cj = findings.find((f) => f.id === "h4-coinjoin");
    expect(cj).toBeDefined();
    expect(cj!.scoreImpact).toBe(25);
  });

  // ── JoinMarket ───────────────────────────────────────────────────────

  it("detects JoinMarket (2-4 equal, distinct addrs, 2-10 vin, 3-8 vout), impact +15", () => {
    const tx = makeTx({
      vin: makeDistinctVins(3),
      vout: [
        makeVout({ value: 500_000, scriptpubkey_address: "bc1qjm1_0000000000000000000000000000000000" }),
        makeVout({ value: 500_000, scriptpubkey_address: "bc1qjm2_0000000000000000000000000000000000" }),
        makeVout({ value: 300_000 }), // change 1
        makeVout({ value: 200_000 }), // change 2
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

  it("detects Stonewall (2-3 vin, 4 vout, 1 equal pair at distinct addrs), impact +15", () => {
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
    expect(findings.find((f) => f.id === "h4-exchange-flagging")).toBeDefined();
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

  // ── isCoinJoinFinding ────────────────────────────────────────────────

  it("isCoinJoinFinding returns true for positive CoinJoin findings", () => {
    expect(isCoinJoinFinding({ id: "h4-whirlpool", scoreImpact: 30, severity: "good", title: "", description: "", recommendation: "" })).toBe(true);
    expect(isCoinJoinFinding({ id: "h4-coinjoin", scoreImpact: 25, severity: "good", title: "", description: "", recommendation: "" })).toBe(true);
    expect(isCoinJoinFinding({ id: "h4-joinmarket", scoreImpact: 15, severity: "good", title: "", description: "", recommendation: "" })).toBe(true);
    expect(isCoinJoinFinding({ id: "h4-stonewall", scoreImpact: 15, severity: "good", title: "", description: "", recommendation: "" })).toBe(true);
  });

  it("isCoinJoinFinding returns false for exchange-flagging (impact 0)", () => {
    expect(isCoinJoinFinding({ id: "h4-exchange-flagging", scoreImpact: 0, severity: "low", title: "", description: "", recommendation: "" })).toBe(false);
  });

  it("isCoinJoinFinding returns false for non-coinjoin findings", () => {
    expect(isCoinJoinFinding({ id: "h3-cioh", scoreImpact: -6, severity: "medium", title: "", description: "", recommendation: "" })).toBe(false);
  });
});
