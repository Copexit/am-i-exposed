import { describe, it, expect } from "vitest";
import { applyMerge, mergeBip329 } from "../bip329-merge";
import { recordKey, type Bip329Record } from "../bip329";

const tx = (n: number) => n.toString(16).padStart(64, "0");
const rec = (n: number, label: string): Bip329Record => ({ type: "tx", ref: tx(n), label });

describe("mergeBip329", () => {
  const existing = [rec(1, "a"), rec(2, "b | aie: toxic change")];
  it("splits added, unchanged (aie part ignored) and conflicts", () => {
    const m = mergeBip329(existing, [rec(1, "a"), rec(2, "b"), rec(3, "c"), rec(1, "z")]);
    expect(m.added.map((r) => r.label)).toEqual(["c"]);
    expect(m.unchanged).toBe(2);
    expect(m.conflicts).toEqual([{ key: recordKey(rec(1, "")), existing: existing[0], incoming: rec(1, "z") }]);
  });
  it("keeps existing by default, replaces only the named keys, appends added", () => {
    const m = mergeBip329(existing, [rec(1, "z"), rec(2, "y"), rec(3, "c")]);
    expect(applyMerge(existing, m, new Set()).map((r) => r.label)).toEqual(["a", "b | aie: toxic change", "c"]);
    expect(applyMerge(existing, m, new Set([recordKey(rec(2, ""))])).map((r) => r.label)).toEqual(["a", "y", "c"]);
  });
});

describe("mergeBip329 spendable", () => {
  it("a label-only record does not conflict with a frozen one of the same label", () => {
    const frozen: Bip329Record = { type: "output", ref: `${tx(1)}:0`, label: "a", spendable: false };
    expect(mergeBip329([frozen], [{ type: "output", ref: frozen.ref, label: "a" }]).unchanged).toBe(1);
    expect(mergeBip329([frozen], [{ ...frozen, spendable: true }]).conflicts).toHaveLength(1);
  });
});

describe("field-wise apply", () => {
  const key = (r: Bip329Record) => new Set([recordKey(r)]);
  it("incoming without spendable keeps the freeze; spendable-only keeps the label", () => {
    const ref = `${tx(1)}:0`;
    const frozen: Bip329Record = { type: "output", ref, label: "a", spendable: false, origin: "o" };
    let m = mergeBip329([frozen], [{ type: "output", ref, label: "b" }]);
    expect(applyMerge([frozen], m, key(frozen))).toEqual([{ type: "output", ref, label: "b", spendable: false, origin: "o" }]);
    const labelled: Bip329Record = { type: "output", ref, label: "a" };
    m = mergeBip329([labelled], [{ type: "output", ref, spendable: false }]);
    expect(m.conflicts).toHaveLength(1);
    expect(applyMerge([labelled], m, key(labelled))).toEqual([{ type: "output", ref, label: "a", spendable: false }]);
  });
  it("labelOnly ignores spendable", () => {
    const r: Bip329Record = { type: "output", ref: `${tx(1)}:0`, label: "a" };
    expect(mergeBip329([r], [{ ...r, spendable: true }], true).unchanged).toBe(1);
  });
});
