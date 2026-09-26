import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EntityMatch } from "@/lib/analysis/entity-filter/types";

vi.mock("@/lib/analysis/entity-filter/entity-match", () => ({
  matchEntitySync: vi.fn<(addr: string) => EntityMatch | null>(() => null),
}));

import { matchEntitySync } from "@/lib/analysis/entity-filter/entity-match";
import { scoreNode, RELEVANCE_THRESHOLD } from "../nodeRelevance";
import {
  makeTx, makeVin, makeVout, makeCoinbaseVin, resetAddrCounter,
} from "@/lib/analysis/heuristics/__tests__/fixtures/tx-factory";

const match = vi.mocked(matchEntitySync);

beforeEach(() => {
  resetAddrCounter();
  match.mockReset();
  match.mockReturnValue(null);
});

const entity = (addr: string, ofac: boolean): EntityMatch => ({
  address: addr, entityName: "Acme", category: "exchange", ofac, confidence: "high",
});

// 2-in/2-out, no structural signal of its own
const plain = () => makeTx({ vin: [makeVin(), makeVin()], vout: [makeVout(), makeVout()] });
const root = makeTx({ vin: [makeVin(), makeVin()], vout: [makeVout(), makeVout()] });

describe("scoreNode", () => {
  it("scores a plain 2-in/2-out neighbour at zero, below the threshold", () => {
    const s = scoreNode(plain(), root, "backward", 1, null);
    expect(s).toEqual({ score: 0, reasons: [] });
    expect(s.score).toBeLessThan(RELEVANCE_THRESHOLD);
  });

  it("weights OFAC entities above ordinary ones and checks outputs first", () => {
    const tx = plain();
    const outAddr = tx.vout[1]?.scriptpubkey_address ?? "";
    match.mockImplementation((a) => (a === outAddr ? entity(a, true) : null));
    expect(scoreNode(tx, root, "forward", 1, null)).toEqual({ score: 60, reasons: ["OFAC entity"] });

    const inAddr = tx.vin[0]?.prevout?.scriptpubkey_address ?? "";
    match.mockImplementation((a) => (a === inAddr ? entity(a, false) : null));
    expect(scoreNode(tx, root, "forward", 1, null).reasons).toEqual(["Entity: Acme (exchange)"]);
  });

  it("does not look up coinbase inputs", () => {
    const tx = makeTx({ vin: [makeCoinbaseVin()], vout: [makeVout(), makeVout()] });
    scoreNode(tx, root, "backward", 1, null);
    expect(match).toHaveBeenCalledTimes(2);
  });

  it("flags consolidation at five non-coinbase inputs", () => {
    const tx = makeTx({ vin: Array.from({ length: 5 }, () => makeVin()), vout: [makeVout(), makeVout()] });
    expect(scoreNode(tx, root, "forward", 1, null)).toEqual({ score: 25, reasons: ["Consolidation (5 inputs)"] });
  });

  it("backward sweep adds sweep, single-input and same-address signals", () => {
    const rootAddr = root.vin[0]?.prevout?.scriptpubkey_address;
    const tx = makeTx({ vin: [makeVin()], vout: [makeVout({ scriptpubkey_address: rootAddr })] });
    expect(scoreNode(tx, root, "backward", 1, null)).toEqual({
      score: 55,
      reasons: ["Sweep", "Single-input parent", "Same address as root input"],
    });
  });

  it("forward: spending change beats spending a payment output; unknown change scores neither", () => {
    expect(scoreNode(plain(), root, "forward", 1, 1, 1)).toEqual({ score: 35, reasons: ["Spends change output"] });
    expect(scoreNode(plain(), root, "forward", 1, 1, 0)).toEqual({ score: 15, reasons: ["Payment recipient action"] });
    expect(scoreNode(plain(), root, "forward", 1, null, 0).score).toBe(0);
  });

  it("applies a depth penalty of 10 per hop beyond the first, in either direction", () => {
    expect(scoreNode(plain(), root, "forward", 1, 1, 1).score).toBe(35);
    expect(scoreNode(plain(), root, "forward", 2, 1, 1)).toEqual({
      score: 25,
      reasons: ["Spends change output", "Depth penalty (-10)"],
    });
    expect(scoreNode(plain(), root, "backward", -4, null).score).toBe(-30);
  });
});
