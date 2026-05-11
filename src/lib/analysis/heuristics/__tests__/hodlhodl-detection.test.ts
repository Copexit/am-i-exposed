import { describe, it, expect } from "vitest";
import type { MempoolTransaction } from "@/lib/api/types";
import { analyzeHodlHodlDetection } from "../hodlhodl-detection";
import tpFixtures from "./fixtures/hodlhodl-tp.json";
import fpFixtures from "./fixtures/hodlhodl-fp.json";

interface Fixture {
  txid: string;
  expected_id: string | null;
  notes: string;
  tx: MempoolTransaction;
}

const tp = tpFixtures as unknown as Fixture[];
const fp = fpFixtures as unknown as Fixture[];

function isEnvelopeDetectable(notes: string): boolean {
  return notes.startsWith("one-party-pays")
    || notes.startsWith("both-parties-pay");
}

describe("HodlHodl detection - true positives (envelope-detectable)", () => {
  for (const fx of tp.filter((f) => isEnvelopeDetectable(f.notes))) {
    it(`TP ${fx.txid.slice(0, 12)} - ${fx.notes}`, () => {
      const { findings } = analyzeHodlHodlDetection(fx.tx);
      const hh = findings.find((f) => f.id === "h17-hodlhodl");
      const iv = fx.tx.vin[0].prevout?.value ?? 0;
      const sp = fx.tx.vout.filter((o) => !o.scriptpubkey.startsWith("6a"));
      const minv = sp.length ? Math.min(...sp.map((o) => o.value)) : 0;
      const ratio = iv ? (minv / iv) * 100 : 0;
      const msg = `MISS ${fx.txid.slice(0, 12)} | ${fx.notes} | inp=${iv} smallest=${minv} ratio=${ratio.toFixed(3)}% spendable=${sp.length} time=${fx.tx.status?.block_time}`;
      expect(hh, msg).toBeDefined();
    });
  }
});

describe("HodlHodl detection - true positives (address-match-only, may or may not fire on envelope)", () => {
  for (const fx of tp.filter((f) => !isEnvelopeDetectable(f.notes))) {
    it.skip(`TP ${fx.txid.slice(0, 12)} - ${fx.notes} (envelope may skip)`, () => {});
  }
});

function isFilterRuleTestable(notes: string): boolean {
  return notes.startsWith("3BMEX")
    || notes.startsWith("input above observed cap")
    || notes.startsWith("dust")
    || notes.startsWith("bare P2WSH");
}

describe("HodlHodl detection - false positives (filter-rule-testable, MUST NOT fire)", () => {
  for (const fx of fp.filter((f) => isFilterRuleTestable(f.notes))) {
    it(`FP ${fx.txid.slice(0, 12)} - ${fx.notes}`, () => {
      const { findings } = analyzeHodlHodlDetection(fx.tx);
      const hh = findings.find((f) => f.id?.startsWith("h17-hodlhodl"));
      const iv = fx.tx.vin[0].prevout?.value ?? 0;
      const sp = fx.tx.vout.filter((o) => !o.scriptpubkey.startsWith("6a"));
      const minv = sp.length ? Math.min(...sp.map((o) => o.value)) : 0;
      const ratio = iv ? (minv / iv) * 100 : 0;
      const msg = `FIRE ${fx.txid.slice(0, 12)} | ${fx.notes} | inp=${iv} smallest=${minv} ratio=${ratio.toFixed(3)}% spendable=${sp.length}`;
      expect(hh, msg).toBeUndefined();
    });
  }
});

describe("HodlHodl detection - structurally-undecidable FPs (bloom-filter-resolved)", () => {
  for (const fx of fp.filter((f) => !isFilterRuleTestable(f.notes))) {
    it.skip(`FP ${fx.txid.slice(0, 12)} - ${fx.notes} (resolved by bloom layer)`, () => {});
  }
});
