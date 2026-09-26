/**
 * v2 view model: invariants over the real-world corpus and the named fixtures,
 * plus focused unit cases. The view model is the single source for everything
 * the v2 UI displays, so these tests pin "every pixel has a source".
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { analyzeTransaction } from "@/lib/analysis/orchestrator";
import { TX_BASE_SCORE } from "@/lib/scoring/score";
import type { MempoolTransaction } from "@/lib/api/types";
import type { Finding, ScoringResult } from "@/lib/types";
import { buildResultViewModel } from "../tx-view-model";
import { buildScoreWaterfall } from "../waterfall";
import { filterFindings, visibleFindings, countFindings } from "../findings";
import { buildTxIoView } from "../tx-io";

const FIXTURES = join(__dirname, "../../analysis/heuristics/__tests__/fixtures/api-responses");
const CORPUS = join(FIXTURES, "corpus");

const corpus = readdirSync(CORPUS).filter((f) => f.endsWith(".json")).sort()
  .map((f) => JSON.parse(readFileSync(join(CORPUS, f), "utf-8")) as { tx: MempoolTransaction; hex: string });
const named = ["whirlpool-coinjoin", "wabisabi-coinjoin", "joinmarket-coinjoin", "simple-legacy-p2pkh", "dust-attack-555", "op-return-charley", "taproot-op-return", "batch-withdrawal-143", "bare-multisig"]
  .map((n) => ({ tx: JSON.parse(readFileSync(join(FIXTURES, `${n}.json`), "utf-8")) as MempoolTransaction, hex: undefined as string | undefined }));

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

async function run(tx: MempoolTransaction, hex?: string): Promise<ScoringResult> {
  const p = analyzeTransaction(tx, hex);
  await vi.runAllTimersAsync();
  return p;
}

describe("view model invariants (corpus + named fixtures)", () => {
  it.each([...corpus, ...named].map((c) => [c.tx.txid.slice(0, 16), c] as const))("%s", async (_id, { tx, hex }) => {
    const result = await run(tx, hex);
    const vm = buildResultViewModel({ result, baseScore: TX_BASE_SCORE, tx });

    // The waterfall reproduces the engine's score exactly.
    expect(vm.waterfall.final).toBe(result.score);
    expect(vm.waterfall.raw).toBe(TX_BASE_SCORE + result.findings.reduce((s, f) => s + f.scoreImpact, 0));
    const last = vm.waterfall.steps.at(-1);
    expect(last ? last.to : vm.waterfall.base).toBe(vm.waterfall.raw);

    // Hidden findings never carry score impact.
    const hidden = result.findings.filter((f) => !vm.visible.includes(f));
    expect(hidden.every((f) => f.scoreImpact === 0)).toBe(true);

    // Groups partition the visible findings; counts agree with them.
    const grouped = [...vm.groups.leaks, ...vm.groups.minor, ...vm.groups.strengths];
    expect(grouped).toHaveLength(vm.visible.length);
    expect(new Set(grouped)).toEqual(new Set(vm.visible));
    expect(vm.counts.issues + vm.counts.strengths).toBe(vm.visible.length);

    // Every IO tag backed by a finding points at a finding the user can see.
    const ids = new Set(vm.visible.map((f) => f.id as string));
    for (const io of [...vm.io!.inputs, ...vm.io!.outputs]) {
      for (const tag of io.tags) {
        if (tag.source.kind === "finding") expect(ids.has(tag.source.findingId)).toBe(true);
        else expect(["anon-set", "co-spent", "same-parent"]).toContain(tag.kind);
      }
    }

    // The change tag sits exactly where h2 says.
    const h2 = vm.visible.find((f) => f.id === "h2-change-detected");
    const changeTagged = vm.io!.outputs.filter((o) => o.tags.some((t) => t.kind === "change")).map((o) => o.index);
    expect(changeTagged).toEqual(h2?.params?.changeIndex !== undefined ? [Number(h2.params.changeIndex)] : []);
  });
});

const f = (over: Partial<Finding> & Pick<Finding, "id" | "scoreImpact" | "severity">): Finding =>
  ({ title: "", description: "", recommendation: "", ...over }) as Finding;

describe("buildScoreWaterfall", () => {
  it("does not clamp mid-way: gains past 100 then losses match the final clamp", () => {
    const w = buildScoreWaterfall([
      f({ id: "h4-whirlpool", severity: "good", scoreImpact: 35 }),
      f({ id: "h1-round-amount", severity: "low", scoreImpact: -10 }),
    ], 70);
    expect(w.steps.map((s) => [s.from, s.to])).toEqual([[70, 105], [105, 95]]);
    expect(w).toMatchObject({ raw: 95, final: 95, clamped: false });
  });

  it("reports the clamp when the raw total leaves 0-100", () => {
    const w = buildScoreWaterfall([f({ id: "h4-whirlpool", severity: "good", scoreImpact: 50 })], 70);
    expect(w).toMatchObject({ raw: 120, final: 100, clamped: true });
  });
});

describe("findings helpers", () => {
  it("treats adversary tiers as cumulative", async () => {
    const { exploitingTiers } = await import("../findings");
    expect([...exploitingTiers(["passive_observer"])]).toEqual(["passive_observer", "kyc_exchange", "state_adversary"]);
    expect([...exploitingTiers(["kyc_exchange", "state_adversary"])]).toEqual(["kyc_exchange", "state_adversary"]);
    expect([...exploitingTiers(["state_adversary"])]).toEqual(["state_adversary"]);
  });

  it("treats zero-impact analysis notices as status, never impactful ones", () => {
    const notice = f({ id: "analysis-incomplete", severity: "low", scoreImpact: 0 });
    const weird = f({ id: "chain-trace-partial", severity: "low", scoreImpact: -2 });
    expect(visibleFindings([notice, weird]).map((x) => x.id)).toEqual(["chain-trace-partial"]);
  });

  it("hides coinjoin-suppressed and chain-trace-summary findings only", () => {
    const list = [
      f({ id: "h1-round-amount", severity: "low", scoreImpact: 0, params: { context: "coinjoin" } }),
      f({ id: "chain-trace-summary", severity: "low", scoreImpact: 0 }),
      f({ id: "h3-cioh", severity: "high", scoreImpact: -6 }),
    ];
    expect(visibleFindings(list).map((x) => x.id)).toEqual(["h3-cioh"]);
  });

  it("filters never hide findings without tier metadata", () => {
    const tagged = f({ id: "h3-cioh", severity: "high", scoreImpact: -6, adversaryTiers: ["passive_observer"], temporality: "historical" });
    const bare = f({ id: "h1-round-amount", severity: "low", scoreImpact: -1 });
    const out = filterFindings([tagged, bare], { adversary: new Set(["state_adversary"]), temporality: new Set(["historical"]) });
    expect(out).toEqual([bare]);
  });

  it("counts findings that raised the score as strengths, not issues", () => {
    const c = countFindings([
      f({ id: "h5-entropy", severity: "low", scoreImpact: 2, temporality: "historical" }),
      f({ id: "h3-cioh", severity: "high", scoreImpact: -6, temporality: "historical" }),
    ]);
    expect(c).toMatchObject({ issues: 1, strengths: 1, worst: "high", historical: 1 });
  });

  it("counts worst severity and temporality of issues only", () => {
    const c = countFindings([
      f({ id: "h3-cioh", severity: "high", scoreImpact: -6, temporality: "historical" }),
      f({ id: "h11-wallet-fingerprint", severity: "low", scoreImpact: -3, temporality: "ongoing_pattern" }),
      f({ id: "h4-whirlpool", severity: "good", scoreImpact: 30, temporality: "historical" }),
    ]);
    expect(c).toMatchObject({ issues: 2, strengths: 1, worst: "high", historical: 1, ongoing: 1, active: 0 });
  });
});

describe("buildTxIoView", () => {
  const tx = named.find((n) => n.tx.txid.startsWith("655c533b"))!.tx; // dust attack fixture

  it("tags nothing the findings do not mention", () => {
    const io = buildTxIoView(tx, []);
    expect([...io.inputs, ...io.outputs].flatMap((x) => x.tags).filter((t) => t.source.kind === "finding")).toEqual([]);
  });

  it("marks outputs spent together and inputs sharing a parent, from raw data only", () => {
    const outspends = tx.vout.map((_, i) => (i < 2 ? { spent: true, txid: "cc".repeat(32) } : { spent: false }));
    const io = buildTxIoView(tx, [], outspends);
    const coSpent = io.outputs.filter((o) => o.tags.some((t) => t.kind === "co-spent")).map((o) => o.index);
    expect(coSpent).toEqual(tx.vout.length >= 2 ? [0, 1] : []);
    const sameParent = io.inputs.filter((i) => i.tags.some((t) => t.kind === "same-parent")).length;
    const parents = new Map<string, number>();
    for (const v of tx.vin) parents.set(v.txid, (parents.get(v.txid) ?? 0) + 1);
    expect(sameParent).toBe([...parents.values()].filter((n) => n >= 2).reduce((a, b) => a + b, 0));
  });

  it("attributes entities to the exact addresses the finding lists", () => {
    const addr = tx.vout[0]!.scriptpubkey_address!;
    const io = buildTxIoView(tx, [
      f({ id: "entity-known-output", severity: "low", scoreImpact: -1, params: { addresses: `${addr.slice(0, 12)}...`, entityName: "Reddit", category: "service" } }),
    ]);
    expect(io.outputs[0]!.tags).toContainEqual(expect.objectContaining({ kind: "entity", params: { entityName: "Reddit", category: "service" } }));
    expect(io.outputs.slice(1).flatMap((o) => o.tags.filter((t) => t.kind === "entity"))).toEqual([]);
  });
});

describe("gradeTagline", () => {
  it("matches the classic ScoreDisplay selection", async () => {
    const { gradeTagline } = await import("../verdict");
    const neg = [f({ id: "h3-cioh", severity: "high", scoreImpact: -6 })];
    const pos = [f({ id: "h4-whirlpool", severity: "good", scoreImpact: 30 })];
    expect(gradeTagline("A+", neg).key).toBe("score.gradeAPlus");
    expect(gradeTagline("B", pos).key).toBe("score.gradeBPositive");
    expect(gradeTagline("B", neg).key).toBe("score.gradeB");
    expect(gradeTagline("B", undefined).key).toBe("score.gradeB");
    expect(gradeTagline("C", pos).key).toBe("score.gradeCPositive");
    expect(gradeTagline("C", neg).key).toBe("score.gradeC");
    expect(gradeTagline("C", undefined).key).toBe("score.gradeC");
    expect(gradeTagline("D", pos).key).toBe("score.gradeD");
    expect(gradeTagline("F", pos).key).toBe("score.gradeF");
  });
});
