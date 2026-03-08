import { describe, it, expect } from "vitest";
import { isPSBT, parsePSBT } from "../psbt";

// Valid PSBT: 1 input (100000 sats P2WPKH witnessUtxo), 1 output (90000 sats P2WPKH), fee 10000
// prettier-ignore
const PSBT_COMPLETE = "cHNidP8BAFICAAAAAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAAAAAAD/////AZBfAQAAAAAAFgAUzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc0AAAAAAAEBH6CGAQAAAAAAFgAUq6urq6urq6urq6urq6urq6urq6sAAA==";

describe("isPSBT", () => {
  it("recognizes base64 PSBT", () => {
    expect(isPSBT(PSBT_COMPLETE)).toBe(true);
  });

  it("recognizes hex PSBT", () => {
    expect(isPSBT("70736274ff0100")).toBe(true);
  });

  it("rejects random string", () => {
    expect(isPSBT("hello world")).toBe(false);
  });

  it("rejects xpub", () => {
    expect(isPSBT("xpub661MyMwAqRbcFtXgS5sYJA")).toBe(false);
  });

  it("rejects txid", () => {
    expect(isPSBT("a".repeat(64))).toBe(false);
  });
});

describe("parsePSBT", () => {
  it("parses a complete PSBT", () => {
    const result = parsePSBT(PSBT_COMPLETE);
    expect(result.inputCount).toBe(1);
    expect(result.outputCount).toBe(1);
    expect(result.tx.vin).toHaveLength(1);
    expect(result.tx.vout).toHaveLength(1);
    expect(result.tx.txid).toBe("psbt-preview");
    expect(result.tx.status.confirmed).toBe(false);
  });

  it("extracts output values and computes fee", () => {
    const result = parsePSBT(PSBT_COMPLETE);
    expect(result.tx.vout[0].value).toBe(90_000);
    expect(result.outputTotal).toBe(90_000);
    expect(result.inputTotal).toBe(100_000);
    expect(result.complete).toBe(true);
    expect(result.fee).toBe(10_000);
  });

  it("rejects invalid PSBT", () => {
    expect(() => parsePSBT("not-a-psbt")).toThrow();
  });

  it("detects P2WPKH script type in outputs", () => {
    const result = parsePSBT(PSBT_COMPLETE);
    expect(result.tx.vout[0].scriptpubkey_type).toBe("v0_p2wpkh");
  });

  it("detects P2WPKH script type in inputs with witnessUtxo", () => {
    const result = parsePSBT(PSBT_COMPLETE);
    expect(result.tx.vin[0].prevout!.scriptpubkey_type).toBe("v0_p2wpkh");
    expect(result.tx.vin[0].prevout!.value).toBe(100_000);
  });

  it("computes fee rate", () => {
    const result = parsePSBT(PSBT_COMPLETE);
    expect(result.feeRate).toBeGreaterThan(0);
    expect(result.vsize).toBeGreaterThan(0);
  });
});
