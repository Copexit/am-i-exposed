import { describe, it, expect, beforeEach } from "vitest";
import { needsEnrichment, enrichPrevouts, countNullPrevouts } from "../enrich-prevouts";
import { makeTx, makeVin, makeVout, makeCoinbaseVin, resetAddrCounter } from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

describe("needsEnrichment", () => {
  it("returns false when prevout is populated", () => {
    const tx = makeTx(); // default makeVin has prevout populated
    expect(needsEnrichment([tx])).toBe(false);
  });

  it("returns true when prevout is null", () => {
    const tx = makeTx({
      vin: [makeVin({ prevout: null } as never)],
    });
    // Force null
    tx.vin[0].prevout = null;
    expect(needsEnrichment([tx])).toBe(true);
  });

  it("skips coinbase inputs", () => {
    const tx = makeTx({ vin: [makeCoinbaseVin()] });
    expect(needsEnrichment([tx])).toBe(false);
  });

  it("returns false for empty tx list", () => {
    expect(needsEnrichment([])).toBe(false);
  });
});

describe("enrichPrevouts", () => {
  it("reconstructs missing prevout from parent transaction", async () => {
    const parentTx = makeTx({
      txid: "parent" + "0".repeat(58),
      vout: [
        makeVout({ value: 50_000, scriptpubkey_address: "bc1qparent000000000000000000000000000000000" }),
        makeVout({ value: 30_000 }),
      ],
    });

    const childTx = makeTx({
      vin: [{
        txid: parentTx.txid,
        vout: 0,
        prevout: null,
        scriptsig: "",
        scriptsig_asm: "",
        is_coinbase: false,
        sequence: 0xfffffffd,
      } as never],
    });
    // Force null
    childTx.vin[0].prevout = null;

    const getTransaction = async (txid: string) => {
      if (txid === parentTx.txid) return parentTx;
      throw new Error("Not found");
    };

    const result = await enrichPrevouts([childTx], { getTransaction });

    expect(result.enrichedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(childTx.vin[0].prevout).not.toBeNull();
    expect(childTx.vin[0].prevout!.value).toBe(50_000);
    expect(childTx.vin[0].prevout!.scriptpubkey_address).toBe("bc1qparent000000000000000000000000000000000");
  });

  it("handles failed parent fetches gracefully", async () => {
    const childTx = makeTx({
      vin: [{
        txid: "missing" + "0".repeat(57),
        vout: 0,
        prevout: null,
        scriptsig: "",
        scriptsig_asm: "",
        is_coinbase: false,
        sequence: 0xfffffffd,
      } as never],
    });
    childTx.vin[0].prevout = null;

    const getTransaction = async () => {
      throw new Error("Network error");
    };

    const result = await enrichPrevouts([childTx], { getTransaction });

    expect(result.failedCount).toBe(1);
    expect(result.enrichedCount).toBe(0);
    expect(childTx.vin[0].prevout).toBeNull();
  });

  it("returns zero counts when no enrichment needed", async () => {
    const tx = makeTx(); // prevout already populated
    const getTransaction = async () => makeTx();

    const result = await enrichPrevouts([tx], { getTransaction });
    expect(result.enrichedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(result.skippedCount).toBe(0);
  });

  it("respects AbortSignal", async () => {
    const childTx = makeTx({
      vin: [{
        txid: "aborted" + "0".repeat(57),
        vout: 0,
        prevout: null,
        scriptsig: "",
        scriptsig_asm: "",
        is_coinbase: false,
        sequence: 0xfffffffd,
      } as never],
    });
    childTx.vin[0].prevout = null;

    const controller = new AbortController();
    controller.abort();

    const getTransaction = async () => makeTx();
    await enrichPrevouts([childTx], {
      getTransaction,
      signal: controller.signal,
    });

    // Aborted before fetching - prevout still null
    expect(childTx.vin[0].prevout).toBeNull();
  });
});

describe("countNullPrevouts", () => {
  it("counts null prevouts", () => {
    const tx = makeTx();
    tx.vin[0].prevout = null;
    expect(countNullPrevouts([tx])).toBe(1);
  });

  it("skips coinbase", () => {
    const tx = makeTx({ vin: [makeCoinbaseVin()] });
    expect(countNullPrevouts([tx])).toBe(0);
  });

  it("returns 0 when all populated", () => {
    expect(countNullPrevouts([makeTx()])).toBe(0);
  });
});
