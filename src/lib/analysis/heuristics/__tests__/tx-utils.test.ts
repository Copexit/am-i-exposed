import { describe, it, expect } from "vitest";
import {
  isOpReturnOutput,
  getSpendableOutputs,
  getValuedOutputs,
  getAddressedOutputs,
} from "../tx-utils";
import { extractTxValues } from "../../boltzmann-detection";
import type { MempoolVout } from "@/lib/api/types";

function vout(overrides: Partial<MempoolVout>): MempoolVout {
  return {
    scriptpubkey: "0014" + "00".repeat(20),
    scriptpubkey_asm: "",
    scriptpubkey_type: "v0_p2wpkh",
    scriptpubkey_address: "bc1qtest",
    value: 50_000,
    ...overrides,
  };
}

// mempool.space labels OP_RETURN via scriptpubkey_type; PSBT-derived txs
// may only carry the raw script (type "unknown").
const apiOpReturn = vout({ scriptpubkey: "6a0468656c6c6f", scriptpubkey_type: "op_return", scriptpubkey_address: undefined, value: 0 });
const psbtOpReturn = vout({ scriptpubkey: "6a0468656c6c6f", scriptpubkey_type: "unknown", scriptpubkey_address: "", value: 1_000 });
const payment = vout({});

describe("isOpReturnOutput", () => {
  it("recognizes OP_RETURN from either the type label or the raw script", () => {
    expect(isOpReturnOutput(apiOpReturn)).toBe(true);
    expect(isOpReturnOutput(psbtOpReturn)).toBe(true);
    expect(isOpReturnOutput(payment)).toBe(false);
  });
});

describe("output filters exclude OP_RETURN in both representations", () => {
  const outs = [apiOpReturn, psbtOpReturn, payment];

  it("getSpendableOutputs", () => {
    expect(getSpendableOutputs(outs)).toEqual([payment]);
  });

  it("getValuedOutputs", () => {
    expect(getValuedOutputs(outs)).toEqual([payment]);
  });

  it("getAddressedOutputs", () => {
    expect(getAddressedOutputs(outs)).toEqual([payment]);
  });

  it("extractTxValues (Boltzmann input) drops a PSBT OP_RETURN with value", () => {
    const { outputValues } = extractTxValues({ vin: [], vout: outs });
    expect(outputValues).toEqual([50_000]);
  });
});
