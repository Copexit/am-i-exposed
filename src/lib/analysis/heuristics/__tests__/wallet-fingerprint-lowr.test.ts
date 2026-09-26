import { describe, it, expect } from "vitest";
import { detectLowRSignatures } from "../wallet-fingerprint-helpers";
import { makeVin } from "./fixtures/tx-factory";

/** DER signature (plus SIGHASH_ALL byte) with the given R bytes and a 32-byte S. */
function der(r: string): string {
  const rPart = "02" + (r.length / 2).toString(16).padStart(2, "0") + r;
  const sPart = "0220" + "22".repeat(32);
  const body = rPart + sPart;
  return "30" + (body.length / 2).toString(16).padStart(2, "0") + body + "01";
}
const LOW_R = der("11".repeat(32));
const HIGH_R = der("00" + "81".repeat(32));
const PUBKEY = "02" + "33".repeat(32);
const SCHNORR = "30ff0220" + "44".repeat(60); // 64 bytes that happen to start like DER

describe("detectLowRSignatures", () => {
  it("detects low-R in P2WPKH witness signatures", () => {
    expect(detectLowRSignatures([makeVin({ witness: [LOW_R, PUBKEY] }), makeVin({ witness: [LOW_R, PUBKEY] })])).toBe(true);
  });

  it("returns false when any signature has a 33-byte R", () => {
    expect(detectLowRSignatures([makeVin({ witness: [LOW_R, PUBKEY] }), makeVin({ witness: [HIGH_R, PUBKEY] })])).toBe(false);
  });

  it("ignores Taproot Schnorr signatures even if their bytes look like DER", () => {
    expect(detectLowRSignatures([makeVin({ witness: [SCHNORR] })])).toBe(false);
  });

  it("parses legacy scriptSig pushes", () => {
    const vin = makeVin({ scriptsig_asm: `OP_PUSHBYTES_71 ${LOW_R} OP_PUSHBYTES_33 ${PUBKEY}` });
    expect(detectLowRSignatures([vin, vin])).toBe(true);
  });

  it("needs at least two signatures (one low-R sig happens by chance ~50% of the time)", () => {
    expect(detectLowRSignatures([makeVin({ witness: [LOW_R, PUBKEY] })])).toBe(false);
  });

  it("returns false with no signatures at all", () => {
    expect(detectLowRSignatures([makeVin()])).toBe(false);
  });
});
