import { describe, it, expect } from "vitest";
import { buildChecklist } from "../pre-broadcast-checklist";
import type { LocalTx } from "@/lib/input/local-tx";
import type { MempoolTransaction } from "@/lib/api/types";
import type { ScoringResult } from "@/lib/types";

const out = (value: number, addr = "bc1qa", type = "v0_p2wpkh") =>
  ({ value, scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: type, scriptpubkey_address: addr });
const vin = (value: number | null, sequence = 0xfffffffd) =>
  ({ txid: "a".repeat(64), vout: 0, prevout: value === null ? null : out(value), scriptsig: "", scriptsig_asm: "", witness: [], is_coinbase: false, sequence });
const tx = (o: Partial<MempoolTransaction>): MempoolTransaction =>
  ({ txid: "psbt-preview", version: 2, locktime: 850_000, vin: [vin(100_000)], vout: [out(60_000), out(39_000, "bc1qb")], size: 141, weight: 564, fee: 1_000, status: { confirmed: false }, ...o });
const local = (status: LocalTx["status"]): LocalTx => ({ source: "psbt", status, tx: tx({}), missingPrevouts: [], signedHex: null, psbt: null });
const result = (findings: ScoringResult["findings"] = []) => ({ score: 80, grade: "B", findings } as unknown as ScoringResult);
const fees = { fastestFee: 20, halfHourFee: 10, hourFee: 5, economyFee: 2, minimumFee: 1 };
const ids = (c: ReturnType<typeof buildChecklist>) => c.safety.map((s) => s.id);

describe("buildChecklist", () => {
  it("absurd fee by rate and by share", () => {
    expect(ids(buildChecklist({ local: local("signed"), tx: tx({ fee: 150_000, vout: [out(1_000_000)] , vin: [vin(1_150_000)] }), result: result(), fees, outputTxCounts: null }))).toContain("fee-absurd");
    expect(ids(buildChecklist({ local: local("signed"), tx: tx({ fee: 20_000, vout: [out(80_000)], vin: [vin(100_000)] }), result: result(), fees, outputTxCounts: null }))).toContain("fee-absurd");
  });
  it("dust, rbf, locktime, unsigned", () => {
    const c = buildChecklist({ local: local("unsigned"), tx: tx({ locktime: 0, vin: [vin(100_000, 0xffffffff)], vout: [out(98_500), out(500, "bc1qd")] }), result: result(), fees, outputTxCounts: null });
    expect(ids(c)).toEqual(expect.arrayContaining(["dust", "rbf-off", "locktime-none", "unsigned", "signatures-later"]));
  });
  it("reused output address from looked-up history", () => {
    const c = buildChecklist({ local: local("signed"), tx: tx({}), result: result(), fees, outputTxCounts: new Map([["bc1qa", 3], ["bc1qb", 0]]) });
    expect(c.safety.find((s) => s.id === "reused-output")?.params).toEqual({ count: 1 });
  });
  it("reveals: top 5 negative findings by severity", () => {
    const f = (id: string, severity: string, scoreImpact: number) => ({ id, severity, scoreImpact, title: id, description: "", confidence: "high" });
    const c = buildChecklist({ local: local("signed"), tx: tx({}), result: result([
      f("a", "low", -1), f("b", "critical", -10), f("c", "good", 5), f("d", "high", -5), f("e", "medium", -3), f("g", "medium", -2), f("h", "low", -1),
    ] as never), fees, outputTxCounts: null });
    expect(c.reveals.map((x) => x.id)).toEqual(["b", "d", "e", "g", "a"]);
  });
  it("fee rate against estimates: high, low, none without estimates", () => {
    // 141 vB; 7_000 sats = ~50 sat/vB > 2x fastest (20), under 10% of outputs
    expect(ids(buildChecklist({ local: local("signed"), tx: tx({ fee: 7_000, vin: [vin(106_000)] }), result: result(), fees, outputTxCounts: null }))).toContain("fee-high");
    // 141 sats = 1 sat/vB < economy (2)
    expect(ids(buildChecklist({ local: local("signed"), tx: tx({ fee: 141, vin: [vin(99_141)] }), result: result(), fees, outputTxCounts: null }))).toContain("fee-low");
    expect(ids(buildChecklist({ local: local("signed"), tx: tx({ fee: 141, vin: [vin(99_141)] }), result: result(), fees: null, outputTxCounts: null })).some((i) => i.startsWith("fee-"))).toBe(false);
  });
  it("no fee items when input amounts are unknown", () => {
    const c = buildChecklist({ local: local("signed"), tx: tx({ vin: [vin(null)], fee: 0 }), result: result(), fees, outputTxCounts: null });
    expect(ids(c).some((i) => i.startsWith("fee-"))).toBe(false);
    expect(c.feeRate).toBeNull();
  });
});
