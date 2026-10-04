import { describe, it, expect } from "vitest";
import { base64 } from "@scure/base";
import { bytesToHex } from "@/lib/bitcoin/hex";
import { buildPsbt } from "./fixtures";
import { parseRawTx, psbtToLocalTx, parseLocalTx, isRawTxHex, PREVIEW_TXID } from "../local-tx";

describe("parseRawTx", () => {
  it("parses a signed segwit tx: status signed, txid real, prevouts missing", () => {
    const t = buildPsbt({ sign: true });
    t.finalize();
    const hex = bytesToHex(t.extract());
    const local = parseRawTx(hex, "mainnet");
    expect(local.source).toBe("raw");
    expect(local.status).toBe("signed");
    expect(local.signedHex).toBe(hex);
    expect(local.tx.txid).toBe(t.id);
    expect(local.missingPrevouts).toEqual([0]);
    expect(local.tx.vin[0]?.prevout).toBeNull();
    expect(local.tx.vout.map((o) => o.value)).toEqual([60_000, 39_000]);
    expect(local.tx.vin[0]?.witness?.length).toBe(2);
    expect(local.tx.weight).toBeGreaterThan(0);
  });

  it("parses an unsigned raw tx (no witnesses): status unsigned, no signedHex", () => {
    const t = buildPsbt({ sign: false });
    const hex = bytesToHex(t.unsignedTx);
    const local = parseRawTx(hex, "mainnet");
    expect(local.status).toBe("unsigned");
    expect(local.signedHex).toBeNull();
    expect(local.tx.txid).toBe(PREVIEW_TXID);
  });

  it("rejects trailing bytes", () => {
    const t = buildPsbt({ sign: true }); t.finalize();
    expect(() => parseRawTx(bytesToHex(t.extract()) + "00", "mainnet")).toThrow();
  });
});

describe("psbtToLocalTx", () => {
  it("unsigned PSBT: status unsigned, prevouts known from witnessUtxo", () => {
    const local = psbtToLocalTx(base64.encode(buildPsbt({ sign: false }).toPSBT()), "mainnet");
    expect(local.status).toBe("unsigned");
    expect(local.missingPrevouts).toEqual([]);
    expect(local.psbt?.fee).toBe(1_000);
  });

  it("signed (not finalized) PSBT: status signed, signedHex extractable", () => {
    const t = buildPsbt({ sign: true });
    const local = psbtToLocalTx(base64.encode(t.toPSBT()), "mainnet");
    expect(local.status).toBe("signed");
    const c = t.clone(); c.finalize();
    expect(local.signedHex).toBe(bytesToHex(c.extract()));
    expect(local.tx.txid).toBe(c.id);
  });

  it("finalized PSBT: status signed", () => {
    const t = buildPsbt({ sign: true }); t.finalize();
    expect(psbtToLocalTx(base64.encode(t.toPSBT()), "mainnet").status).toBe("signed");
  });

  it("parses a realistic PSBT longer than 512 chars (non_witness_utxo)", () => {
    const b64 = base64.encode(buildPsbt({ sign: false, nonWitness: true }).toPSBT());
    expect(b64.length).toBeGreaterThan(512);
    expect(psbtToLocalTx(b64, "mainnet").tx.vout).toHaveLength(2);
  });
});

describe("parseLocalTx / isRawTxHex", () => {
  it("dispatches PSBT base64, PSBT hex and raw hex", () => {
    const t = buildPsbt({ sign: true });
    expect(parseLocalTx(base64.encode(t.toPSBT()), "mainnet").source).toBe("psbt");
    expect(parseLocalTx(bytesToHex(t.toPSBT()), "mainnet").source).toBe("psbt");
    t.finalize();
    expect(parseLocalTx(bytesToHex(t.extract()), "mainnet").source).toBe("raw");
  });

  it("isRawTxHex: true only for a strictly parseable tx", () => {
    const t = buildPsbt({ sign: true }); t.finalize();
    expect(isRawTxHex(bytesToHex(t.extract()))).toBe(true);
    expect(isRawTxHex("ab".repeat(80))).toBe(false);   // random hex
    expect(isRawTxHex("a".repeat(64))).toBe(false);    // txid
    expect(isRawTxHex("zz")).toBe(false);
  });
});
