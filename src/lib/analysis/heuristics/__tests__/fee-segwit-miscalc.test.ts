import { describe, it, expect } from "vitest";
import { analyzeFees } from "../fee-analysis";
import { makeTx, makeVin } from "./fixtures/tx-factory";

// size 250 bytes, weight 661 WU (vsize 166): a SegWit tx
const segwitTx = (fee: number) =>
  makeTx({ size: 250, weight: 661, fee, vin: [makeVin({ witness: ["30", "02"] })] });
const fires = (fee: number) =>
  analyzeFees(segwitTx(fee)).findings.some((f) => f.id === "h6-fee-segwit-miscalc");

describe("h6-fee-segwit-miscalc", () => {
  it("fires when the fee is an exact integer rate times the raw size", () => {
    expect(fires(5000)).toBe(true); // 20 sat/B * 250 B
  });

  it("does not fire when fee/size is only near an integer", () => {
    expect(fires(5020)).toBe(false); // 20.08 sat/B
  });

  it("does not fire at 1 sat/B (indistinguishable from a minimum-fee tx)", () => {
    expect(fires(250)).toBe(false);
  });

  it("fires on well under 2% of a fee sweep", () => {
    let hits = 0;
    let total = 0;
    for (let fee = 2000; fee <= 20000; fee++, total++) if (fires(fee)) hits++;
    expect(hits / total).toBeLessThan(0.02);
  });
});
