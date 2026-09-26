import { describe, it, expect } from "vitest";
import { analyzeUtxoAgeSpread } from "../utxo-age-spread";
import type { MempoolTransaction } from "@/lib/api/types";

function makeTx(overrides: Partial<MempoolTransaction> = {}): MempoolTransaction {
  return {
    txid: "abc123",
    version: 2,
    locktime: 0,
    size: 250,
    weight: 1000,
    fee: 1000,
    vin: [],
    vout: [],
    status: { confirmed: true, block_height: 800000 },
    ...overrides,
  };
}

function makeVin(txid: string) {
  return {
    txid,
    vout: 0,
    prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1q" + txid.slice(0, 38), value: 100000 },
    scriptsig: "",
    scriptsig_asm: "",
    is_coinbase: false,
    sequence: 0xfffffffe,
  };
}

describe("analyzeUtxoAgeSpread", () => {
  it("returns no findings for single-input transactions", () => {
    const tx = makeTx({ vin: [makeVin("aaa")] });
    const { findings } = analyzeUtxoAgeSpread(tx);
    expect(findings).toHaveLength(0);
  });

  it("returns no findings when parent txs are not available", () => {
    const tx = makeTx({ vin: [makeVin("aaa"), makeVin("bbb")] });
    const { findings } = analyzeUtxoAgeSpread(tx, undefined, {});
    expect(findings).toHaveLength(0);
  });

  it("returns no findings when spread is under 1 year", () => {
    const tx = makeTx({ vin: [makeVin("aaa"), makeVin("bbb")] });
    const parentTxs = new Map<string, MempoolTransaction>();
    parentTxs.set("aaa", makeTx({ txid: "aaa", status: { confirmed: true, block_height: 790000 } }));
    parentTxs.set("bbb", makeTx({ txid: "bbb", status: { confirmed: true, block_height: 799000 } }));
    // Spread = 9000 blocks, well under 52560
    const { findings } = analyzeUtxoAgeSpread(tx, undefined, { parentTxs });
    expect(findings).toHaveLength(0);
  });

  it("flags LOW when spread exceeds 1 year", () => {
    const tx = makeTx({ vin: [makeVin("aaa"), makeVin("bbb")] });
    const parentTxs = new Map<string, MempoolTransaction>();
    parentTxs.set("aaa", makeTx({ txid: "aaa", status: { confirmed: true, block_height: 700000 } }));
    parentTxs.set("bbb", makeTx({ txid: "bbb", status: { confirmed: true, block_height: 799000 } }));
    // Spread = 99000 blocks > 52560 (1 year)
    const { findings } = analyzeUtxoAgeSpread(tx, undefined, { parentTxs });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe("utxo-age-spread");
    expect(findings[0]?.severity).toBe("low");
    expect(findings[0]?.scoreImpact).toBe(-2);
  });

  it("flags MEDIUM when spread exceeds 4 years", () => {
    const tx = makeTx({ vin: [makeVin("aaa"), makeVin("bbb")] });
    const parentTxs = new Map<string, MempoolTransaction>();
    parentTxs.set("aaa", makeTx({ txid: "aaa", status: { confirmed: true, block_height: 400000 } }));
    parentTxs.set("bbb", makeTx({ txid: "bbb", status: { confirmed: true, block_height: 799000 } }));
    // Spread = 399000 blocks > 210240 (4 years)
    const { findings } = analyzeUtxoAgeSpread(tx, undefined, { parentTxs });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("medium");
    expect(findings[0]?.scoreImpact).toBe(-4);
  });

  it("skips coinbase transactions", () => {
    const vin = makeVin("aaa");
    vin.is_coinbase = true;
    const tx = makeTx({ vin: [vin, makeVin("bbb")] });
    const { findings } = analyzeUtxoAgeSpread(tx);
    expect(findings).toHaveLength(0);
  });

  it("skips unconfirmed transactions", () => {
    const tx = makeTx({
      vin: [makeVin("aaa"), makeVin("bbb")],
      status: { confirmed: false },
    });
    const { findings } = analyzeUtxoAgeSpread(tx);
    expect(findings).toHaveLength(0);
  });

  it("includes adversaryTiers and temporality", () => {
    const tx = makeTx({ vin: [makeVin("aaa"), makeVin("bbb")] });
    const parentTxs = new Map<string, MempoolTransaction>();
    parentTxs.set("aaa", makeTx({ txid: "aaa", status: { confirmed: true, block_height: 400000 } }));
    parentTxs.set("bbb", makeTx({ txid: "bbb", status: { confirmed: true, block_height: 799000 } }));
    const { findings } = analyzeUtxoAgeSpread(tx, undefined, { parentTxs });
    expect(findings[0]?.adversaryTiers).toContain("passive_observer");
    expect(findings[0]?.temporality).toBe("historical");
  });
});
