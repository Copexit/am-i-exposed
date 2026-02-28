import { describe, it, expect } from "vitest";
import { getAddressType } from "../address-type";

describe("getAddressType", () => {
  it("detects P2TR from bc1p prefix", () => {
    expect(getAddressType("bc1p" + "a".repeat(58))).toBe("p2tr");
  });

  it("detects P2TR from tb1p prefix (testnet)", () => {
    expect(getAddressType("tb1p" + "a".repeat(58))).toBe("p2tr");
  });

  it("detects P2WPKH from short bc1q (length <= 50)", () => {
    expect(getAddressType("bc1q" + "a".repeat(38))).toBe("p2wpkh"); // 42 chars total
  });

  it("detects P2WSH from long bc1q (length > 50)", () => {
    expect(getAddressType("bc1q" + "a".repeat(58))).toBe("p2wsh"); // 62 chars total
  });

  it("detects P2WPKH from short tb1q (testnet)", () => {
    expect(getAddressType("tb1q" + "a".repeat(38))).toBe("p2wpkh");
  });

  it("detects P2SH from 3... prefix", () => {
    expect(getAddressType("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy")).toBe("p2sh");
  });

  it("detects P2SH from 2... prefix (testnet)", () => {
    expect(getAddressType("2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc")).toBe("p2sh");
  });

  it("detects P2PKH from 1... prefix", () => {
    expect(getAddressType("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")).toBe("p2pkh");
  });

  it("detects P2PKH from m... prefix (testnet)", () => {
    expect(getAddressType("mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn")).toBe("p2pkh");
  });

  it("detects P2PKH from n... prefix (testnet)", () => {
    expect(getAddressType("n1B4fC3hXL7bFnCDEmhxZh1P2t3J9zmhHd")).toBe("p2pkh");
  });

  it("returns unknown for unrecognized prefix", () => {
    expect(getAddressType("xyz123")).toBe("unknown");
  });
});
