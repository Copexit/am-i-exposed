import { describe, it, expect, beforeEach } from "vitest";
import { analyzeUtxos } from "../utxo-analysis";
import { makeAddress, makeUtxo, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

const addr = makeAddress();

describe("analyzeUtxos", () => {
  it("detects 3+ dust UTXOs -> h9-dust-detected, impact -8, severity high", () => {
    const utxos = [
      makeUtxo({ value: 500 }),
      makeUtxo({ value: 300 }),
      makeUtxo({ value: 200 }),
    ];
    const { findings } = analyzeUtxos(addr, utxos, []);
    const f = findings.find((f) => f.id === "h9-dust-detected");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-8);
    expect(f!.severity).toBe("high");
  });

  it("detects 1-2 dust UTXOs -> h9-dust-detected, impact -5, severity medium", () => {
    const utxos = [makeUtxo({ value: 500 }), makeUtxo({ value: 50_000 })];
    const { findings } = analyzeUtxos(addr, utxos, []);
    const f = findings.find((f) => f.id === "h9-dust-detected");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-5);
    expect(f!.severity).toBe("medium");
  });

  it("detects 20+ UTXOs -> h9-many-utxos, impact -3", () => {
    const utxos = Array.from({ length: 20 }, () => makeUtxo({ value: 50_000 }));
    const { findings } = analyzeUtxos(addr, utxos, []);
    const f = findings.find((f) => f.id === "h9-many-utxos");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-3);
  });

  it("detects 5-19 UTXOs -> h9-moderate-utxos, impact -2", () => {
    const utxos = Array.from({ length: 7 }, () => makeUtxo({ value: 50_000 }));
    const { findings } = analyzeUtxos(addr, utxos, []);
    const f = findings.find((f) => f.id === "h9-moderate-utxos");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-2);
  });

  it("returns h9-clean for < 5 UTXOs with no dust, impact +2", () => {
    const utxos = [makeUtxo({ value: 50_000 }), makeUtxo({ value: 30_000 })];
    const { findings } = analyzeUtxos(addr, utxos, []);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("h9-clean");
    expect(findings[0].scoreImpact).toBe(2);
    expect(findings[0].severity).toBe("good");
  });

  it("returns empty for no UTXOs", () => {
    const { findings } = analyzeUtxos(addr, [], []);
    expect(findings).toHaveLength(0);
  });

  it("stacks dust + many-utxos findings", () => {
    const utxos = [
      ...Array.from({ length: 3 }, () => makeUtxo({ value: 500 })),
      ...Array.from({ length: 20 }, () => makeUtxo({ value: 50_000 })),
    ];
    const { findings } = analyzeUtxos(addr, utxos, []);
    expect(findings.find((f) => f.id === "h9-dust-detected")).toBeDefined();
    expect(findings.find((f) => f.id === "h9-many-utxos")).toBeDefined();
  });
});
