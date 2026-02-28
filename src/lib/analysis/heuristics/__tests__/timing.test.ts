import { describe, it, expect, beforeEach } from "vitest";
import { analyzeTiming } from "../timing";
import { makeTx, makeCoinbaseVin, makeVout, resetAddrCounter } from "./fixtures/tx-factory";

beforeEach(() => resetAddrCounter());

describe("analyzeTiming", () => {
  it("flags unconfirmed transaction with impact -2", () => {
    const tx = makeTx({ status: { confirmed: false } });
    const { findings } = analyzeTiming(tx);
    const f = findings.find((f) => f.id === "timing-unconfirmed");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-2);
    expect(f!.severity).toBe("low");
  });

  it("flags locktime as UNIX timestamp with impact -3", () => {
    const tx = makeTx({ locktime: 1_700_000_000 });
    const { findings } = analyzeTiming(tx);
    const f = findings.find((f) => f.id === "timing-locktime-timestamp");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-3);
    expect(f!.severity).toBe("medium");
  });

  it("flags stale locktime (block_height - locktime > 20) with impact -1", () => {
    const tx = makeTx({
      locktime: 799_950,
      status: { confirmed: true, block_height: 800_000, block_time: 1700000000 },
    });
    const { findings } = analyzeTiming(tx);
    const f = findings.find((f) => f.id === "timing-stale-locktime");
    expect(f).toBeDefined();
    expect(f!.scoreImpact).toBe(-1);
    expect(f!.severity).toBe("low");
  });

  it("does not flag normal anti-fee-sniping locktime (diff <= 20)", () => {
    const tx = makeTx({
      locktime: 799_990,
      status: { confirmed: true, block_height: 800_000, block_time: 1700000000 },
    });
    const { findings } = analyzeTiming(tx);
    expect(findings.find((f) => f.id === "timing-stale-locktime")).toBeUndefined();
  });

  it("returns multiple findings that stack", () => {
    // Unconfirmed + locktime timestamp
    const tx = makeTx({
      locktime: 1_700_000_000,
      status: { confirmed: false },
    });
    const { findings } = analyzeTiming(tx);
    expect(findings.find((f) => f.id === "timing-unconfirmed")).toBeDefined();
    expect(findings.find((f) => f.id === "timing-locktime-timestamp")).toBeDefined();
  });

  it("skips coinbase transactions", () => {
    const tx = makeTx({
      vin: [makeCoinbaseVin()],
      vout: [makeVout({ value: 625_000_000 })],
      status: { confirmed: false },
    });
    const { findings } = analyzeTiming(tx);
    expect(findings).toHaveLength(0);
  });

  it("returns empty for confirmed tx with locktime 0", () => {
    const tx = makeTx({ locktime: 0 });
    const { findings } = analyzeTiming(tx);
    expect(findings).toHaveLength(0);
  });
});
