import { describe, it, expect, beforeEach } from "vitest";
import { calculateBdd } from "../bdd";
import { makeTx, makeVin, resetAddrCounter } from "../../heuristics/__tests__/fixtures/tx-factory";
import type { MempoolTransaction } from "@/lib/api/types";

beforeEach(() => resetAddrCounter());

function makeParentTx(txid: string, blockTime: number): MempoolTransaction {
  return makeTx({
    txid,
    status: { confirmed: true, block_height: 790000, block_time: blockTime },
  });
}

describe("calculateBdd", () => {
  it("calculates BDD from parent tx timestamps", () => {
    const parentTxid = "p".repeat(64);
    const txTime = 1700000000; // current tx
    const parentTime = 1700000000 - 86400 * 365; // 365 days ago

    const tx = makeTx({
      vin: [makeVin({ txid: parentTxid, prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1q", value: 100_000_000 } })],
      status: { confirmed: true, block_height: 800000, block_time: txTime },
    });

    const parentTxs = new Map<string, MempoolTransaction>();
    parentTxs.set(parentTxid, makeParentTx(parentTxid, parentTime));

    const result = calculateBdd(tx, parentTxs);
    // 1 BTC * 365 days = 365 BDD
    expect(result.totalBdd).toBe(365);
    expect(result.inputBreakdown).toHaveLength(1);
    expect(result.inputBreakdown[0].daysHeld).toBe(365);
  });

  it("returns very high BDD finding for 1000+ BDD", () => {
    const parentTxid = "p".repeat(64);
    const txTime = 1700000000;
    const parentTime = txTime - 86400 * 100; // 100 days ago

    const tx = makeTx({
      vin: [makeVin({ txid: parentTxid, prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1q", value: 10_00_000_000 } })],
      status: { confirmed: true, block_height: 800000, block_time: txTime },
    });

    const parentTxs = new Map<string, MempoolTransaction>();
    parentTxs.set(parentTxid, makeParentTx(parentTxid, parentTime));

    const result = calculateBdd(tx, parentTxs);
    // 10 BTC * 100 days = 1000 BDD
    expect(result.totalBdd).toBe(1000);
    const f = result.findings.find((f) => f.id === "bdd-very-high");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-2);
  });

  it("returns low BDD finding for recent coins", () => {
    const parentTxid = "p".repeat(64);
    const txTime = 1700000000;
    const parentTime = txTime - 3600; // 1 hour ago

    const tx = makeTx({
      vin: [makeVin({ txid: parentTxid, prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1q", value: 100_000 } })],
      status: { confirmed: true, block_height: 800000, block_time: txTime },
    });

    const parentTxs = new Map<string, MempoolTransaction>();
    parentTxs.set(parentTxid, makeParentTx(parentTxid, parentTime));

    const result = calculateBdd(tx, parentTxs);
    const f = result.findings.find((f) => f.id === "bdd-low");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("good");
  });

  it("returns empty for unconfirmed tx", () => {
    const tx = makeTx({ status: { confirmed: false } });
    const result = calculateBdd(tx);
    expect(result.totalBdd).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it("handles missing parent tx data gracefully", () => {
    const tx = makeTx({
      status: { confirmed: true, block_height: 800000, block_time: 1700000000 },
    });
    // No parent txs provided
    const result = calculateBdd(tx, new Map());
    expect(result.totalBdd).toBe(0);
    expect(result.findings).toHaveLength(0);
  });
});
