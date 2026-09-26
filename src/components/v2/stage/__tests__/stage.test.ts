import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { analyzeTransactionSync } from "@/lib/analysis/analyze-sync";
import { TX_BASE_SCORE } from "@/lib/scoring/score";
import { buildResultViewModel } from "@/lib/view/tx-view-model";
import type { IoView } from "@/lib/view/tx-io";
import type { MempoolTransaction } from "@/lib/api/types";
import { buildStageRows, layoutFlow, rowCount, MIN_BAND } from "../stage-layout";
import { buildAnalystReadings, bestLinkProb } from "../analyst";

const FIXTURES = join(__dirname, "../../../../lib/analysis/heuristics/__tests__/fixtures/api-responses");
const vmOf = (name: string) => {
  const tx = JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf-8")) as MempoolTransaction;
  return buildResultViewModel({ result: analyzeTransactionSync(tx), baseScore: TX_BASE_SCORE, tx });
};

const io = (index: number, value: number, tags: IoView["tags"] = []): IoView =>
  ({ index, address: `a${index}`, value, scriptType: "v0_p2wpkh", tags, spent: null });
const anon = (n: number): IoView["tags"][number] => ({ kind: "anon-set", severity: "good", source: { kind: "tx" }, params: { anonSet: n } });

describe("buildStageRows", () => {
  it("groups anon-set outputs into tiers (biggest set first) and keeps singles in order", () => {
    const items = [io(0, 5, [anon(2)]), io(1, 9), io(2, 7, [anon(3)]), io(3, 5, [anon(2)]), io(4, 7, [anon(3)]), io(5, 7, [anon(3)])];
    const rows = buildStageRows(items, "output", { groupTiers: true, limit: null });
    expect(rows.map((r) => r.key)).toEqual(["output-tier-7", "output-tier-5", "output-1"]);
    const tier = rows[0]!;
    expect(tier.kind === "tier" && tier.members.length).toBe(3);
    expect(tier.value).toBe(21);
    expect(rows.reduce((s, r) => s + rowCount(r), 0)).toBe(items.length);
  });

  it("never re-detects tiers: equal values without an anon-set tag stay separate", () => {
    const rows = buildStageRows([io(0, 5), io(1, 5)], "output", { groupTiers: true, limit: null });
    expect(rows.map((r) => r.kind)).toEqual(["io", "io"]);
  });

  it("collapses beyond the limit but keeps finding-backed rows visible", () => {
    const change = { kind: "change" as const, severity: "high" as const, source: { kind: "finding" as const, findingId: "h2-change-detected" as const } };
    const items = Array.from({ length: 20 }, (_, i) => io(i, 100 + i, i === 17 ? [change] : []));
    const rows = buildStageRows(items, "input", { groupTiers: false, limit: 6 });
    expect(rows).toHaveLength(6);
    expect(rows.some((r) => r.key === "input-17")).toBe(true);
    const more = rows.at(-1)!;
    expect(more.kind).toBe("more");
    expect(rows.reduce((s, r) => s + rowCount(r), 0)).toBe(20);
    expect(rows.reduce((s, r) => s + r.value, 0)).toBe(items.reduce((s, i) => s + i.value, 0));
  });

  it("aggregates the WabiSabi fixture to a bounded number of rows that account for every output", () => {
    const vm = vmOf("wabisabi-coinjoin");
    const rows = buildStageRows(vm.io!.outputs, "output", { groupTiers: true, limit: 12 });
    expect(rows.length).toBeLessThanOrEqual(12);
    expect(rows.reduce((s, r) => s + rowCount(r), 0)).toBe(vm.io!.outputs.length);
    expect(rows[0]!.kind).toBe("tier");
  });
});

describe("layoutFlow", () => {
  it("uses one linear scale for both sides and floors tiny bands", () => {
    const { ribbons, junction } = layoutFlow(
      [{ key: "i0", y: 50, value: 1000 }],
      [{ key: "o0", y: 20, value: 990 }, { key: "o1", y: 80, value: 1 }],
      { width: 200, maxBand: 40, maxJunction: 100 },
    );
    const w = Object.fromEntries(ribbons.map((r) => [r.key, r.width]));
    expect(w.i0).toBe(40);
    expect(w.o0).toBeCloseTo(39.6);
    expect(w.o1).toBe(MIN_BAND);
    expect(junction.x).toBe(100);
    expect(junction.y1 - junction.y0).toBeCloseTo(Math.max(40, 39.6 + MIN_BAND));
    for (const r of ribbons) expect(r.d).toMatch(/^M[\d.-]+,[\d.-]+C.*Z$/);
  });

  it("caps the junction height for many inputs", () => {
    const ports = Array.from({ length: 10 }, (_, i) => ({ key: `i${i}`, y: i * 50, value: 100 }));
    const { junction } = layoutFlow(ports, [{ key: "o", y: 0, value: 1000 }], { width: 100, maxBand: 400, maxJunction: 120 });
    expect(junction.y1 - junction.y0).toBeCloseTo(120);
  });
});

describe("buildAnalystReadings", () => {
  it("legacy payment: change reading with signal agreement, the other output reads as a payment", () => {
    const vm = vmOf("simple-legacy-p2pkh");
    const r = buildAnalystReadings(vm);
    expect(r.outputs.get(1)).toMatchObject({ kind: "change", findingId: "h2-change-detected" });
    expect(r.outputs.get(0)).toMatchObject({ kind: "payment", findingId: "h2-change-detected" });
    expect(r.blinded).toBeNull();
  });

  it("self-send and OP_RETURN: no payment is invented without a change finding", () => {
    const r = buildAnalystReadings(vmOf("op-return-charley"));
    expect(r.outputs.get(1)).toMatchObject({ kind: "self-send" });
    expect(r.outputs.get(0)).toBeUndefined();
  });

  it("Whirlpool: blinded tiers from anon-set tags, no CIOH hull, wallet guess kept", () => {
    const r = buildAnalystReadings(vmOf("whirlpool-coinjoin"));
    expect(r.blinded?.tiers).toEqual([{ unit: 5_000_000, count: 5 }]);
    expect(r.cluster).toBeNull();
    expect(r.wallet?.name).toBe("Ashigaru/Sparrow");
    expect([...r.outputs.values()].every((o) => o.kind === "blinded")).toBe(true);
  });

  it("bestLinkProb takes the max over inputs", () => {
    const m = [[0.2, 0.9], [0.5, 0.5]];
    expect(bestLinkProb((i, o) => m[o]![i]!, 2, 0)).toBe(0.9);
  });
});

describe("entity readings", () => {
  it("lists each named entity tag once per side, with its finding", () => {
    const vm = vmOf("simple-legacy-p2pkh");
    const tag = { kind: "entity" as const, severity: "low" as const, source: { kind: "finding" as const, findingId: "entity-known-output" as const }, params: { entityName: "BTCC" } };
    vm.io!.outputs[0]!.tags.push(tag, { ...tag });
    expect(buildAnalystReadings(vm).entities).toEqual([{ name: "BTCC", side: "output", ofac: false, findingId: "entity-known-output" }]);
  });
});

describe("consolidation tags", () => {
  const co = (childTxid: string): IoView["tags"][number] => ({ kind: "co-spent", severity: "medium", source: { kind: "tx" }, params: { count: 2, childTxid } });
  it("tier rows keep one co-spent tag per child tx", () => {
    const items = [io(0, 5, [anon(3), co("a")]), io(1, 5, [anon(3), co("a")]), io(2, 5, [anon(3), co("b")])];
    const [tier] = buildStageRows(items, "output", { groupTiers: true, limit: null });
    if (!tier || tier.kind === "more") throw new Error("expected a tier row");
    expect(tier.tags.map((t) => t.params?.childTxid)).toEqual(["a", "b"]);
  });
  it("analyst groups co-spent outputs and same-parent inputs by transaction", () => {
    const vm = vmOf("whirlpool-coinjoin");
    vm.io!.outputs[0]!.tags.push(co("child"));
    vm.io!.outputs[3]!.tags.push(co("child"));
    vm.io!.inputs[1]!.tags.push({ kind: "same-parent", severity: "low", source: { kind: "tx" }, params: { count: 2, parentTxid: "par" } });
    const r = buildAnalystReadings(vm);
    expect(r.coSpent).toEqual([{ count: 2, txid: "child" }]);
    expect(r.sameParent).toEqual([{ count: 2, txid: "par" }]);
  });
});

describe("layoutVerticalFlow", () => {
  it("keeps list order, stays inside the width and sizes segments by value", async () => {
    const { layoutVerticalFlow } = await import("../stage-layout");
    const f = layoutVerticalFlow(
      [{ key: "i0", value: 100 }, { key: "i1", value: 300 }],
      [{ key: "o0", value: 50 }, { key: "o1", value: 340 }],
      { width: 358, height: 140 },
    );
    const ins = f.ribbons.filter((r) => r.side === "input");
    const outs = f.ribbons.filter((r) => r.side === "output");
    expect(ins.map((r) => r.key)).toEqual(["i0", "i1"]);
    expect(ins[0]!.bar[1]).toBeLessThanOrEqual(ins[1]!.bar[0]);
    const w = (r: { bar: [number, number] }) => r.bar[1] - r.bar[0];
    expect(w(ins[1]!)).toBeGreaterThan(w(ins[0]!) * 2);
    expect(w(outs[1]!)).toBeGreaterThan(w(outs[0]!));
    for (const r of f.ribbons) {
      expect(r.bar[0]).toBeGreaterThanOrEqual(0);
      expect(r.bar[1]).toBeLessThanOrEqual(358 + 1e-9);
    }
    expect(f.junction.x0).toBeGreaterThan(0);
    expect(f.junction.x1).toBeLessThan(358);
  });
});
