import { describe, it, expect } from "vitest";
import { isRbfSignaling } from "../tx-utils";
import { makeVin, makeCoinbaseVin } from "./fixtures/tx-factory";

describe("isRbfSignaling", () => {
  it("is true when a regular input has nSequence < 0xfffffffe", () => {
    expect(isRbfSignaling([makeVin({ sequence: 0xfffffffd })])).toBe(true);
  });

  it("is false for final / anti-fee-sniping sequences", () => {
    expect(isRbfSignaling([makeVin({ sequence: 0xfffffffe }), makeVin({ sequence: 0xffffffff })])).toBe(false);
  });

  it("ignores the coinbase input's sequence", () => {
    expect(isRbfSignaling([{ ...makeCoinbaseVin(), sequence: 0 }])).toBe(false);
  });
});
