import { describe, it, expect, beforeEach } from "vitest";
import { analyzeCioh } from "../cioh";
import { makeTx, makeVin, makeCoinbaseVin, makeVout, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

/** Helper: create N vins each with a unique address. */
function makeVinsWithDistinctAddrs(n: number) {
  return Array.from({ length: n }, (_, i) =>
    makeVin({
      prevout: {
        scriptpubkey: "",
        scriptpubkey_asm: "",
        scriptpubkey_type: "v0_p2wpkh",
        scriptpubkey_address: `bc1qcioh${String(i).padStart(34, "0")}`,
        value: 100_000,
      },
    }),
  );
}

describe("analyzeCioh", () => {
  it("returns h3-single-input with impact 0 for single input address", () => {
    const tx = makeTx({ vin: [makeVin()] });
    const { findings } = analyzeCioh(tx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h3-single-input");
    expect(findings[0].scoreImpact).toBe(0);
    expect(findings[0].severity).toBe("good");
  });

  it("returns h3-cioh with impact -6 for 2 addresses, severity medium", () => {
    const tx = makeTx({ vin: makeVinsWithDistinctAddrs(2) });
    const { findings } = analyzeCioh(tx);
    expect(findings[0].id).toBe("h3-cioh");
    expect(findings[0].scoreImpact).toBe(-6);
    expect(findings[0].severity).toBe("medium");
  });

  it("returns impact -9 for 3 addresses, severity medium", () => {
    const tx = makeTx({ vin: makeVinsWithDistinctAddrs(3) });
    const { findings } = analyzeCioh(tx);
    expect(findings[0].scoreImpact).toBe(-9);
    expect(findings[0].severity).toBe("medium");
  });

  it("returns impact -12 for 4 addresses, severity high", () => {
    const tx = makeTx({ vin: makeVinsWithDistinctAddrs(4) });
    const { findings } = analyzeCioh(tx);
    expect(findings[0].scoreImpact).toBe(-12);
    expect(findings[0].severity).toBe("high");
  });

  it("returns impact -15 for 5-9 addresses, severity high", () => {
    const tx = makeTx({ vin: makeVinsWithDistinctAddrs(5) });
    const { findings } = analyzeCioh(tx);
    expect(findings[0].scoreImpact).toBe(-15);
    expect(findings[0].severity).toBe("high");
  });

  it("returns impact -25 for 10-19 addresses, severity critical", () => {
    const tx = makeTx({ vin: makeVinsWithDistinctAddrs(10) });
    const { findings } = analyzeCioh(tx);
    expect(findings[0].scoreImpact).toBe(-25);
    expect(findings[0].severity).toBe("critical");
  });

  it("returns impact -35 for 20-49 addresses, severity critical", () => {
    const tx = makeTx({ vin: makeVinsWithDistinctAddrs(20) });
    const { findings } = analyzeCioh(tx);
    expect(findings[0].scoreImpact).toBe(-35);
    expect(findings[0].severity).toBe("critical");
  });

  it("returns impact -45 for 50+ addresses, severity critical", () => {
    const tx = makeTx({ vin: makeVinsWithDistinctAddrs(50) });
    const { findings } = analyzeCioh(tx);
    expect(findings[0].scoreImpact).toBe(-45);
    expect(findings[0].severity).toBe("critical");
  });

  it("deduplicates same address across inputs", () => {
    const sameAddr = "bc1qdup00000000000000000000000000000000000";
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: sameAddr, value: 50_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: sameAddr, value: 50_000 } }),
      ],
    });
    const { findings } = analyzeCioh(tx);
    // Only 1 unique address -> single input
    expect(findings[0].id).toBe("h3-single-input");
    expect(findings[0].scoreImpact).toBe(0);
  });

  it("skips coinbase inputs when counting addresses", () => {
    const tx = makeTx({
      vin: [makeCoinbaseVin()],
      vout: [makeVout({ value: 625_000_000 })],
    });
    const { findings } = analyzeCioh(tx);
    // Coinbase has no address -> uniqueInputAddresses.size = 0 -> <= 1 -> h3-single-input
    expect(findings[0].id).toBe("h3-single-input");
  });
});
