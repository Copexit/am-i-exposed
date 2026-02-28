import { describe, it, expect } from "vitest";
import { analyzeAddressType } from "../address-type";
import { makeAddress } from "./fixtures/tx-factory";

describe("analyzeAddressType", () => {
  it("detects bc1p (Taproot) -> h10-p2tr, impact 0, severity good", () => {
    const addr = makeAddress({ address: "bc1p" + "a".repeat(58) });
    const { findings } = analyzeAddressType(addr, [], []);
    expect(findings[0].id).toBe("h10-p2tr");
    expect(findings[0].scoreImpact).toBe(0);
    expect(findings[0].severity).toBe("good");
  });

  it("detects short bc1q (P2WPKH) -> h10-p2wpkh, impact 0, severity good", () => {
    const addr = makeAddress({ address: "bc1q" + "a".repeat(38) });
    const { findings } = analyzeAddressType(addr, [], []);
    expect(findings[0].id).toBe("h10-p2wpkh");
    expect(findings[0].scoreImpact).toBe(0);
    expect(findings[0].severity).toBe("good");
  });

  it("detects long bc1q (P2WSH) -> h10-p2wsh, impact -2, severity low", () => {
    const addr = makeAddress({ address: "bc1q" + "a".repeat(58) });
    const { findings } = analyzeAddressType(addr, [], []);
    expect(findings[0].id).toBe("h10-p2wsh");
    expect(findings[0].scoreImpact).toBe(-2);
    expect(findings[0].severity).toBe("low");
  });

  it("detects 3... address (P2SH) -> h10-p2sh, impact -3, severity medium", () => {
    const addr = makeAddress({ address: "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy" });
    const { findings } = analyzeAddressType(addr, [], []);
    expect(findings[0].id).toBe("h10-p2sh");
    expect(findings[0].scoreImpact).toBe(-3);
    expect(findings[0].severity).toBe("medium");
  });

  it("detects 1... address (P2PKH) -> h10-p2pkh, impact -5, severity medium", () => {
    const addr = makeAddress({ address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" });
    const { findings } = analyzeAddressType(addr, [], []);
    expect(findings[0].id).toBe("h10-p2pkh");
    expect(findings[0].scoreImpact).toBe(-5);
    expect(findings[0].severity).toBe("medium");
  });

  it("returns empty for unknown address type", () => {
    const addr = makeAddress({ address: "unknown_address" });
    const { findings } = analyzeAddressType(addr, [], []);
    expect(findings).toHaveLength(0);
  });
});
