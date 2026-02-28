import { describe, it, expect, beforeEach } from "vitest";
import { analyzeSpendingPattern } from "../spending-analysis";
import { makeAddress, makeTx, makeVin, makeVout, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

const ADDR = "bc1q" + "a".repeat(38);

describe("analyzeSpendingPattern", () => {
  it("detects high volume (100+ txs) -> spending-high-volume, impact -3", () => {
    const address = makeAddress({
      address: ADDR,
      chain_stats: { funded_txo_count: 50, funded_txo_sum: 5_000_000, spent_txo_count: 50, spent_txo_sum: 5_000_000, tx_count: 100 },
    });
    const { findings } = analyzeSpendingPattern(address, [], []);
    const f = findings.find((f) => f.id === "spending-high-volume");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-3);
    expect(f!.severity).toBe("medium");
  });

  it("detects never-spent (cold storage) -> spending-never-spent, impact +2", () => {
    const address = makeAddress({
      address: ADDR,
      chain_stats: { funded_txo_count: 1, funded_txo_sum: 100_000, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 1 },
    });
    const { findings } = analyzeSpendingPattern(address, [], []);
    const f = findings.find((f) => f.id === "spending-never-spent");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(2);
    expect(f!.severity).toBe("good");
  });

  it("detects 20+ counterparties -> spending-many-counterparties, impact -2", () => {
    const address = makeAddress({
      address: ADDR,
      chain_stats: { funded_txo_count: 1, funded_txo_sum: 1_000_000, spent_txo_count: 25, spent_txo_sum: 900_000, tx_count: 26 },
    });
    // Create 25 txs where ADDR is sender, each to a unique counterparty
    const txs = Array.from({ length: 25 }, (_, i) =>
      makeTx({
        vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: ADDR, value: 40_000 } })],
        vout: [makeVout({ value: 30_000, scriptpubkey_address: `bc1qcp${String(i).padStart(37, "0")}` })],
      }),
    );
    const { findings } = analyzeSpendingPattern(address, [], txs);
    const f = findings.find((f) => f.id === "spending-many-counterparties");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-2);
  });

  it("returns multiple stacked findings (high volume + many counterparties)", () => {
    const address = makeAddress({
      address: ADDR,
      chain_stats: { funded_txo_count: 50, funded_txo_sum: 5_000_000, spent_txo_count: 50, spent_txo_sum: 4_000_000, tx_count: 100 },
    });
    const txs = Array.from({ length: 25 }, (_, i) =>
      makeTx({
        vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: ADDR, value: 40_000 } })],
        vout: [makeVout({ value: 30_000, scriptpubkey_address: `bc1qcp${String(i).padStart(37, "0")}` })],
      }),
    );
    const { findings } = analyzeSpendingPattern(address, [], txs);
    expect(findings.find((f) => f.id === "spending-high-volume")).toBeDefined();
    expect(findings.find((f) => f.id === "spending-many-counterparties")).toBeDefined();
  });

  it("returns empty when no patterns detected", () => {
    const address = makeAddress({
      address: ADDR,
      chain_stats: { funded_txo_count: 1, funded_txo_sum: 100_000, spent_txo_count: 1, spent_txo_sum: 50_000, tx_count: 2 },
    });
    // 1 tx where ADDR sends to a single counterparty
    const txs = [
      makeTx({
        vin: [makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: ADDR, value: 100_000 } })],
        vout: [makeVout({ value: 50_000 })],
      }),
    ];
    const { findings } = analyzeSpendingPattern(address, [], txs);
    expect(findings).toHaveLength(0);
  });
});
