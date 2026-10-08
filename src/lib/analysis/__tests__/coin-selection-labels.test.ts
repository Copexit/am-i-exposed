import { describe, it, expect } from "vitest";
import { adviseCoinSelection, type CoinSelectionAdvice, type CoinSelectionInput } from "../coin-selection";
import type { LabelTag } from "@/lib/wallet/labels";

let seq = 0;
function coin(value: number, tags: LabelTag[] = [], who = "", extra: Partial<CoinSelectionInput> = {}): CoinSelectionInput {
  seq++;
  const origins = tags.filter(t => t !== "change" && t !== "toxic").map(t => `${t}:${who}`);
  return {
    utxo: { txid: `tx${seq}`, vout: 0, value, status: { confirmed: true } },
    address: `bc1qaddr${seq}`,
    ...(tags.length ? { labelTags: tags, labelOrigins: origins } : {}),
    ...extra,
  };
}
const plans = (a: CoinSelectionAdvice) => {
  if (a.kind !== "plans") throw new Error(a.kind);
  return a.plans;
};
const ids = (p: { warnings: { id: string }[] }) => p.warnings.map(w => w.id);
const values = (p: { selected: CoinSelectionInput[] }) => p.selected.map(s => s.utxo.value).sort((a, b) => b - a);

describe("label rules in coin selection", () => {
  it("rule 1: [KYC] with [noKYC] is a critical warning and ranks below a same-origin merge", () => {
    const k1 = coin(60_000, ["kyc"], "bitstamp");
    const n1 = coin(55_000, ["nokyc"], "bisq");
    const k2 = coin(45_000, ["kyc"], "bitstamp");
    const all = plans(adviseCoinSelection([k1, n1, k2], 90_000, 2));
    expect(values(all[0]!)).toEqual([60_000, 45_000]);
    expect(all[0]!.labelRules).toEqual([{ id: "kyc", ok: true }, { id: "origin", ok: true }]);
    // Forced merge: only KYC + noKYC pays
    const forced = plans(adviseCoinSelection([coin(60_000, ["kyc"], "x"), coin(55_000, ["nokyc"], "y")], 100_000, 2))[0]!;
    expect(forced.warnings[0]).toMatchObject({ id: "label-kyc", severity: "critical" });
    expect(forced.labelRules).toContainEqual({ id: "kyc", ok: false });
  });

  it("rule 2: [CJ] merged with other coins warns and costs; a [CJ] coin alone respects it", () => {
    const cj = coin(60_000, ["cj"], "whirlpool");
    const plain = coin(55_000);
    const merged = plans(adviseCoinSelection([cj, plain], 100_000, 2))[0]!;
    expect(ids(merged)).toContain("label-coinjoin");
    expect(merged.labelRules).toContainEqual({ id: "coinjoin", ok: false });
    const alone = plans(adviseCoinSelection([coin(60_000, ["cj"], "w"), coin(30_000)], 50_000, 2))[0]!;
    expect(alone.selected).toHaveLength(1);
    expect(alone.selected[0]!.labelTags).toEqual(["cj"]);
    expect(alone.labelRules).toEqual([{ id: "coinjoin", ok: true }, { id: "origin", ok: true }]);
  });

  it("rule 3: different explicit origins warn unless already certainly linked", () => {
    const a = coin(60_000, ["kyc"], "bitstamp", { cluster: "c1" });
    const b = coin(55_000, ["kyc"], "kraken", { cluster: "c2" });
    const apart = plans(adviseCoinSelection([a, b], 100_000, 2))[0]!;
    expect(apart.warnings.find(w => w.id === "label-origins")).toMatchObject({ severity: "medium", count: 2 });
    const linked = plans(adviseCoinSelection([{ ...a }, { ...b, cluster: "c1" }], 100_000, 2))[0]!;
    expect(ids(linked)).not.toContain("label-origins");
    expect(linked.labelRules).toContainEqual({ id: "origin", ok: true });
    expect([apart.facts.links, linked.facts.links]).toEqual([1, 0]);
  });

  it("rule 2: one violation, not two, when the [CJ] coin is a mixed output on-chain", () => {
    const mixedCj = coin(60_000, ["cj"], "w", { origin: "mixed" });
    const other = coin(55_000);
    const labeled = plans(adviseCoinSelection([mixedCj, other], 100_000, 2))[0]!;
    const unlabeled = plans(adviseCoinSelection([{ ...mixedCj, labelTags: undefined, labelOrigins: undefined }, other], 100_000, 2))[0]!;
    expect(ids(labeled)).toContain("coinjoin-mix");
    expect(ids(labeled)).not.toContain("label-coinjoin");
    expect(labeled.labelRules).toContainEqual({ id: "coinjoin", ok: false });
    expect(labeled.facts.violations).toEqual(unlabeled.facts.violations);
  });

  it("rule 5: a [toxic] coin merged with others warns", () => {
    const p = plans(adviseCoinSelection([coin(60_000, ["toxic"]), coin(55_000)], 100_000, 2))[0]!;
    expect(ids(p)).toContain("label-toxic");
  });

  it("no labels: no label rules, no label warnings, same plans", () => {
    const cs = [coin(60_000), coin(55_000), coin(45_000)];
    const p = plans(adviseCoinSelection(cs, 90_000, 2));
    expect(p.every(x => x.labelRules.length === 0 && !ids(x).some(i => i.startsWith("label-")))).toBe(true);
  });
});
