/**
 * Tests for the human-readable output formatter.
 */
import { describe, it, expect } from "vitest";
import { formatTxResult, formatAddressResult, formatWalletResult } from "../src/output/formatter";
import type { ScoringResult } from "@/lib/types";
import type { PrimaryRec } from "@/lib/recommendations/primary-recommendation";
import type { WalletAuditResult } from "@/lib/analysis/wallet-audit";
import { buildWalletGraph, utxoOrigins } from "@/lib/analysis/wallet-behavior";
import { makeTx, makeVin, makeVout } from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";

describe("formatTxResult", () => {
  const baseResult: ScoringResult = {
    score: 95,
    grade: "A+",
    findings: [
      {
        id: "h4-whirlpool",
        severity: "good",
        title: "Whirlpool CoinJoin detected",
        description: "5 equal outputs at known denomination.",
        recommendation: "Maintain UTXO separation.",
        scoreImpact: 30,
      },
      {
        id: "h3-cioh",
        severity: "low",
        title: "Common input ownership (5 addresses)",
        description: "Suppressed in CoinJoin context.",
        recommendation: "",
        scoreImpact: 0,
      },
    ],
    txType: "whirlpool-coinjoin",
  };

  it("includes transaction id in output", () => {
    const tx = makeTx();
    const output = formatTxResult("abc123", baseResult, tx, "mainnet");
    expect(output).toContain("abc123");
  });

  it("includes score and grade", () => {
    const tx = makeTx();
    const output = formatTxResult("abc123", baseResult, tx, "mainnet");
    expect(output).toContain("95/100");
    expect(output).toContain("A+");
  });

  it("includes transaction type", () => {
    const tx = makeTx();
    const output = formatTxResult("abc123", baseResult, tx, "mainnet");
    expect(output).toContain("Whirlpool Coinjoin");
  });

  it("includes network", () => {
    const tx = makeTx();
    const output = formatTxResult("abc123", baseResult, tx, "testnet4");
    expect(output).toContain("testnet4");
  });

  it("includes all finding titles", () => {
    const tx = makeTx();
    const output = formatTxResult("abc123", baseResult, tx, "mainnet");
    expect(output).toContain("Whirlpool CoinJoin detected");
    expect(output).toContain("Common input ownership (5 addresses)");
  });

  it("shows score impacts", () => {
    const tx = makeTx();
    const output = formatTxResult("abc123", baseResult, tx, "mainnet");
    expect(output).toContain("+30");
  });

  it("includes recommendation when provided", () => {
    const tx = makeTx();
    const rec: PrimaryRec = {
      id: "post-coinjoin",
      urgency: "when-convenient",
      headlineKey: "rec.headline",
      headlineDefault: "Keep doing CoinJoin",
      detailKey: "rec.detail",
      detailDefault: "Maintain UTXO separation after mixing.",
    };
    const output = formatTxResult("abc123", baseResult, tx, "mainnet", rec);
    expect(output).toContain("Keep doing CoinJoin");
    expect(output).toContain("RECOMMENDATION");
  });

  it("does not duplicate 'sats' in output", () => {
    const tx = makeTx({ fee: 5000 });
    const output = formatTxResult("abc123", baseResult, tx, "mainnet");
    expect(output).not.toContain("sats sats");
  });

  it("shows input/output counts", () => {
    const tx = makeTx({
      vin: [makeVin(), makeVin(), makeVin()],
      vout: [makeVout(), makeVout()],
    });
    const output = formatTxResult("abc123", baseResult, tx, "mainnet");
    expect(output).toContain("3");
    expect(output).toContain("2");
  });
});

describe("formatAddressResult", () => {
  it("includes address and grade", () => {
    const result: ScoringResult = {
      score: 0,
      grade: "F",
      findings: [
        {
          id: "h8-reuse",
          severity: "critical",
          title: "Address reused 90 times",
          description: "Extreme reuse.",
          recommendation: "Stop reusing.",
          scoreImpact: -90,
        },
      ],
    };
    const output = formatAddressResult("bc1qtest", result, "mainnet");
    expect(output).toContain("bc1qtest");
    expect(output).toContain("F");
    expect(output).toContain("0/100");
  });
});

describe("formatWalletResult", () => {
  it("includes wallet stats", () => {
    const result: WalletAuditResult = {
      score: 65,
      grade: "C",
      findings: [],
      activeAddresses: 22,
      totalTxs: 45,
      totalUtxos: 8,
      totalBalance: 1500000,
      reusedAddresses: 3,
      dustUtxos: 1,
      utxoOrigins: utxoOrigins(buildWalletGraph([]), []),
    };
    const output = formatWalletResult("zpub6abc...", result, "mainnet");
    expect(output).toContain("22");
    expect(output).toContain("45");
    expect(output).toContain("8");
    expect(output).toContain("3");
    expect(output).toContain("65/100");
    expect(output).toContain("C");
  });
});
