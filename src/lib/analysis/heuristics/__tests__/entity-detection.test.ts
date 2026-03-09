import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeTx, makeVin, makeVout, makeCoinbaseVin, resetAddrCounter } from "./fixtures/tx-factory";

// Mock entity-match and filter-loader modules
vi.mock("../../entity-filter/entity-match", () => ({
  matchEntitySync: vi.fn(() => null),
  detectEntityBehavior: vi.fn(() => null),
}));

vi.mock("../../entity-filter/filter-loader", () => ({
  getFilter: vi.fn(() => ({ meta: { fpr: 0.001 } })),
  getFilterStatus: vi.fn(() => "ready"),
}));

import { analyzeEntityDetection } from "../entity-detection";
import { matchEntitySync, detectEntityBehavior } from "../../entity-filter/entity-match";
import { getFilter, getFilterStatus } from "../../entity-filter/filter-loader";

const mockMatchEntitySync = vi.mocked(matchEntitySync);
const mockDetectEntityBehavior = vi.mocked(detectEntityBehavior);
const mockGetFilter = vi.mocked(getFilter);
const mockGetFilterStatus = vi.mocked(getFilterStatus);

beforeEach(() => {
  resetAddrCounter();
  vi.clearAllMocks();
  mockMatchEntitySync.mockReturnValue(null);
  mockDetectEntityBehavior.mockReturnValue(null);
  mockGetFilter.mockReturnValue({ meta: { fpr: 0.001, addressCount: 1000, version: 1, buildDate: "" }, has: () => false });
  mockGetFilterStatus.mockReturnValue("ready");
});

describe("analyzeEntityDetection", () => {
  it("returns empty findings for normal transaction with no entity matches", () => {
    const { findings } = analyzeEntityDetection(makeTx());
    expect(findings).toHaveLength(0);
  });

  it("skips coinbase transactions entirely", () => {
    const tx = makeTx({ vin: [makeCoinbaseVin()], vout: [makeVout()] });
    const { findings } = analyzeEntityDetection(tx);
    expect(findings).toHaveLength(0);
    expect(mockMatchEntitySync).not.toHaveBeenCalled();
  });

  describe("OFAC detection", () => {
    it("detects OFAC-sanctioned address in inputs", () => {
      const inputAddr = "bc1q" + "0".repeat(38);
      const tx = makeTx({
        vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: inputAddr, value: 100000 } })],
      });

      mockMatchEntitySync.mockImplementation((addr) =>
        addr === inputAddr
          ? { address: addr, entityName: "OFAC Sanctioned", category: "exchange", ofac: true, confidence: "high" }
          : null,
      );

      const { findings } = analyzeEntityDetection(tx);
      const ofac = findings.find((f) => f.id === "entity-ofac-match");
      expect(ofac).toBeDefined();
      expect(ofac!.severity).toBe("critical");
      expect(ofac!.scoreImpact).toBe(-20);
      expect(ofac!.params?.side).toBe("input");
    });

    it("detects OFAC-sanctioned address in outputs", () => {
      const outputAddr = "bc1q" + "1".repeat(38);
      const tx = makeTx({
        vout: [makeVout({ scriptpubkey_address: outputAddr })],
      });

      mockMatchEntitySync.mockImplementation((addr) =>
        addr === outputAddr
          ? { address: addr, entityName: "OFAC Sanctioned", category: "mixer", ofac: true, confidence: "high" }
          : null,
      );

      const { findings } = analyzeEntityDetection(tx);
      const ofac = findings.find((f) => f.id === "entity-ofac-match");
      expect(ofac).toBeDefined();
      expect(ofac!.severity).toBe("critical");
      expect(ofac!.params?.side).toBe("output");
    });

    it("reports 'both' when OFAC addresses appear in inputs and outputs", () => {
      const inputAddr = "bc1q" + "0".repeat(38);
      const outputAddr = "bc1q" + "1".repeat(38);
      const tx = makeTx({
        vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: inputAddr, value: 100000 } })],
        vout: [makeVout({ scriptpubkey_address: outputAddr })],
      });

      mockMatchEntitySync.mockImplementation((addr) =>
        addr === inputAddr || addr === outputAddr
          ? { address: addr, entityName: "OFAC Sanctioned", category: "exchange", ofac: true, confidence: "high" }
          : null,
      );

      const { findings } = analyzeEntityDetection(tx);
      const ofac = findings.find((f) => f.id === "entity-ofac-match");
      expect(ofac!.params?.side).toBe("both");
      expect(ofac!.params?.matchCount).toBe(2);
    });
  });

  describe("known entity detection", () => {
    it("detects known entity in inputs", () => {
      const inputAddr = "bc1q" + "a".repeat(38);
      const tx = makeTx({
        vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: inputAddr, value: 100000 } })],
      });

      mockMatchEntitySync.mockImplementation((addr) =>
        addr === inputAddr
          ? { address: addr, entityName: "Kraken", category: "exchange", ofac: false, confidence: "high" }
          : null,
      );

      const { findings } = analyzeEntityDetection(tx);
      const entity = findings.find((f) => f.id === "entity-known-input");
      expect(entity).toBeDefined();
      expect(entity!.severity).toBe("medium");
      expect(entity!.scoreImpact).toBe(-3);
      expect(entity!.params?.matchCount).toBe(1);
    });

    it("detects known entity in outputs", () => {
      const outputAddr = "bc1q" + "b".repeat(38);
      const tx = makeTx({
        vout: [makeVout({ scriptpubkey_address: outputAddr }), makeVout()],
      });

      mockMatchEntitySync.mockImplementation((addr) =>
        addr === outputAddr
          ? { address: addr, entityName: "Binance", category: "exchange", ofac: false, confidence: "high" }
          : null,
      );

      const { findings } = analyzeEntityDetection(tx);
      const entity = findings.find((f) => f.id === "entity-known-output");
      expect(entity).toBeDefined();
      expect(entity!.severity).toBe("low");
      expect(entity!.scoreImpact).toBe(-1);
    });

    it("reports both input and output entity findings separately", () => {
      const inputAddr = "bc1q" + "a".repeat(38);
      const outputAddr = "bc1q" + "b".repeat(38);
      const tx = makeTx({
        vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: inputAddr, value: 100000 } })],
        vout: [makeVout({ scriptpubkey_address: outputAddr })],
      });

      mockMatchEntitySync.mockImplementation((addr) => {
        if (addr === inputAddr) return { address: addr, entityName: "Kraken", category: "exchange", ofac: false, confidence: "high" };
        if (addr === outputAddr) return { address: addr, entityName: "Binance", category: "exchange", ofac: false, confidence: "high" };
        return null;
      });

      const { findings } = analyzeEntityDetection(tx);
      expect(findings.find((f) => f.id === "entity-known-input")).toBeDefined();
      expect(findings.find((f) => f.id === "entity-known-output")).toBeDefined();
    });

    it("separates OFAC from non-OFAC matches", () => {
      const ofacAddr = "bc1q" + "a".repeat(38);
      const entityAddr = "bc1q" + "b".repeat(38);
      const tx = makeTx({
        vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: ofacAddr, value: 100000 } })],
        vout: [makeVout({ scriptpubkey_address: entityAddr })],
      });

      mockMatchEntitySync.mockImplementation((addr) => {
        if (addr === ofacAddr) return { address: addr, entityName: "OFAC Sanctioned", category: "darknet", ofac: true, confidence: "high" };
        if (addr === entityAddr) return { address: addr, entityName: "Coinbase", category: "exchange", ofac: false, confidence: "high" };
        return null;
      });

      const { findings } = analyzeEntityDetection(tx);
      expect(findings.find((f) => f.id === "entity-ofac-match")).toBeDefined();
      expect(findings.find((f) => f.id === "entity-known-output")).toBeDefined();
      // OFAC input should NOT appear in entity-known-input (filtered out)
      expect(findings.find((f) => f.id === "entity-known-input")).toBeUndefined();
    });
  });

  describe("behavioral detection", () => {
    it("detects exchange batch withdrawal pattern", () => {
      mockDetectEntityBehavior.mockReturnValue({ type: "exchange-batch", confidence: "medium" });

      const { findings } = analyzeEntityDetection(makeTx());
      const behavior = findings.find((f) => f.id === "entity-behavior-exchange");
      expect(behavior).toBeDefined();
      expect(behavior!.severity).toBe("low");
      expect(behavior!.scoreImpact).toBe(0);
    });

    it("detects darknet mixing pattern", () => {
      mockDetectEntityBehavior.mockReturnValue({ type: "darknet-mixing", confidence: "medium" });

      const { findings } = analyzeEntityDetection(makeTx());
      const behavior = findings.find((f) => f.id === "entity-behavior-darknet");
      expect(behavior).toBeDefined();
      expect(behavior!.severity).toBe("medium");
      expect(behavior!.scoreImpact).toBe(-2);
    });

    it("detects gambling pattern", () => {
      mockDetectEntityBehavior.mockReturnValue({ type: "gambling", confidence: "medium" });

      const { findings } = analyzeEntityDetection(makeTx());
      const behavior = findings.find((f) => f.id === "entity-behavior-gambling");
      expect(behavior).toBeDefined();
      expect(behavior!.severity).toBe("low");
      expect(behavior!.scoreImpact).toBe(-1);
    });

    it("suppresses behavioral when filter match already exists", () => {
      const inputAddr = "bc1q" + "a".repeat(38);
      const tx = makeTx({
        vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: inputAddr, value: 100000 } })],
      });

      mockMatchEntitySync.mockImplementation((addr) =>
        addr === inputAddr
          ? { address: addr, entityName: "Kraken", category: "exchange", ofac: false, confidence: "high" }
          : null,
      );
      mockDetectEntityBehavior.mockReturnValue({ type: "exchange-batch", confidence: "medium" });

      const { findings } = analyzeEntityDetection(tx);
      // Filter match present: behavioral should be suppressed
      expect(findings.find((f) => f.id === "entity-behavior-exchange")).toBeUndefined();
      expect(findings.find((f) => f.id === "entity-known-input")).toBeDefined();
    });

    it("suppresses behavioral when output entity match exists", () => {
      const outputAddr = "bc1q" + "b".repeat(38);
      const tx = makeTx({
        vout: [makeVout({ scriptpubkey_address: outputAddr })],
      });

      mockMatchEntitySync.mockImplementation((addr) =>
        addr === outputAddr
          ? { address: addr, entityName: "Binance", category: "exchange", ofac: false, confidence: "high" }
          : null,
      );
      mockDetectEntityBehavior.mockReturnValue({ type: "exchange-batch", confidence: "medium" });

      const { findings } = analyzeEntityDetection(tx);
      expect(findings.find((f) => f.id === "entity-behavior-exchange")).toBeUndefined();
      expect(findings.find((f) => f.id === "entity-known-output")).toBeDefined();
    });
  });

  describe("edge cases", () => {
    it("handles transaction with no addresses", () => {
      const tx = makeTx({
        vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "op_return", scriptpubkey_address: "", value: 0 } })],
        vout: [makeVout({ scriptpubkey_address: undefined })],
      });
      const { findings } = analyzeEntityDetection(tx);
      expect(findings).toHaveLength(0);
    });

    it("deduplicates same address appearing in multiple inputs", () => {
      const addr = "bc1q" + "f".repeat(38);
      const vin = makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: addr, value: 50000 } });
      const tx = makeTx({ vin: [vin, { ...vin, vout: 1 }] });

      let callCount = 0;
      mockMatchEntitySync.mockImplementation((a) => {
        if (a === addr) callCount++;
        return null;
      });

      analyzeEntityDetection(tx);
      // Address appears in Set, so should only be checked once
      expect(callCount).toBe(1);
    });

    it("handles filter not ready gracefully", () => {
      mockGetFilterStatus.mockReturnValue("idle");
      mockGetFilter.mockReturnValue(null);

      const { findings } = analyzeEntityDetection(makeTx());
      // Should still check OFAC (always available) but no filter matches expected
      expect(findings).toHaveLength(0);
    });
  });
});
