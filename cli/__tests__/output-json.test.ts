/**
 * Tests for JSON output - verifies the schema and data integrity.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ScoringResult } from "@/lib/types";
import type { PrimaryRec } from "@/lib/recommendations/primary-recommendation";
import type { WalletAuditResult } from "@/lib/analysis/wallet-audit";
import { makeTx } from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";

// Capture console.log output for JSON tests
let captured: string[] = [];
const originalLog = console.log;

beforeEach(() => {
  captured = [];
  console.log = (...args: unknown[]) => {
    captured.push(args.map(String).join(" "));
  };
});

afterEach(() => {
  console.log = originalLog;
});

// Dynamic import to avoid circular import issues with console mock
async function getJsonModule() {
  return await import("../src/output/json");
}

describe("txJson", () => {
  it("produces valid JSON with correct envelope", async () => {
    const { txJson } = await getJsonModule();
    const result: ScoringResult = {
      score: 100,
      grade: "A+",
      findings: [
        {
          id: "test-finding",
          severity: "good",
          title: "Test",
          description: "Test description",
          recommendation: "Test rec",
          scoreImpact: 10,
        },
      ],
      txType: "whirlpool-coinjoin",
    };
    const tx = makeTx();

    txJson("abcd1234", result, tx, "mainnet", null);

    expect(captured).toHaveLength(1);
    const parsed = JSON.parse(captured[0]);

    expect(parsed.version).toBe("0.34.2");
    expect(parsed.input.type).toBe("txid");
    expect(parsed.input.value).toBe("abcd1234");
    expect(parsed.network).toBe("mainnet");
    expect(parsed.score).toBe(100);
    expect(parsed.grade).toBe("A+");
    expect(parsed.txType).toBe("whirlpool-coinjoin");
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0].id).toBe("test-finding");
    expect(parsed.txInfo.inputs).toBe(tx.vin.length);
    expect(parsed.txInfo.outputs).toBe(tx.vout.length);
    expect(parsed.txInfo.fee).toBe(tx.fee);
  });

  it("includes recommendation when provided", async () => {
    const { txJson } = await getJsonModule();
    const rec: PrimaryRec = {
      id: "test-rec",
      urgency: "immediate",
      headlineKey: "k",
      headlineDefault: "Do this now",
      detailKey: "d",
      detailDefault: "Details here",
      tools: [{ name: "Sparrow", url: "https://sparrowwallet.com" }],
    };

    txJson("abcd", { score: 50, grade: "C", findings: [] }, makeTx(), "mainnet", rec);

    const parsed = JSON.parse(captured[0]);
    expect(parsed.recommendation.id).toBe("test-rec");
    expect(parsed.recommendation.urgency).toBe("immediate");
    expect(parsed.recommendation.headline).toBe("Do this now");
    expect(parsed.recommendation.tools).toHaveLength(1);
  });
});

describe("addressJson", () => {
  it("produces valid JSON with address info", async () => {
    const { addressJson } = await getJsonModule();

    addressJson(
      "bc1qtest",
      { score: 0, grade: "F", findings: [] },
      "mainnet",
      { type: "p2wpkh", txCount: 92, balance: 50000 },
    );

    const parsed = JSON.parse(captured[0]);
    expect(parsed.input.type).toBe("address");
    expect(parsed.input.value).toBe("bc1qtest");
    expect(parsed.addressInfo.type).toBe("p2wpkh");
    expect(parsed.addressInfo.txCount).toBe(92);
  });
});

describe("walletJson", () => {
  it("produces valid JSON with wallet stats", async () => {
    const { walletJson } = await getJsonModule();
    const result: WalletAuditResult = {
      score: 72,
      grade: "C",
      findings: [],
      activeAddresses: 15,
      totalTxs: 30,
      totalUtxos: 5,
      totalBalance: 500000,
      reusedAddresses: 2,
      dustUtxos: 0,
    };

    walletJson("zpub6abc", result, "mainnet");

    const parsed = JSON.parse(captured[0]);
    expect(parsed.input.type).toBe("xpub");
    expect(parsed.walletInfo.activeAddresses).toBe(15);
    expect(parsed.walletInfo.reusedAddresses).toBe(2);
    expect(parsed.walletInfo.totalBalance).toBe(500000);
  });
});

describe("psbtJson", () => {
  it("produces valid JSON with PSBT info", async () => {
    const { psbtJson } = await getJsonModule();

    psbtJson(
      "cHNidP8BAH0C...",
      { score: 45, grade: "D", findings: [], txType: "simple-payment" },
      { inputs: 2, outputs: 3, estimatedFee: 1500, estimatedVsize: 234 },
    );

    const parsed = JSON.parse(captured[0]);
    expect(parsed.input.type).toBe("psbt");
    expect(parsed.psbtInfo.inputs).toBe(2);
    expect(parsed.psbtInfo.outputs).toBe(3);
    expect(parsed.psbtInfo.estimatedFee).toBe(1500);
  });
});
