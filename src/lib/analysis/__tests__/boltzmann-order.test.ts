import { describe, it, expect } from "vitest";
import { toSubmittedOrder, type BoltzmannWorkerResult } from "../boltzmann-pool";

// boltzmann-rs returns matrices with rows (outputs) and columns (inputs)
// sorted by value descending, stable for ties. Consumers need tx order.
describe("toSubmittedOrder", () => {
  it("maps value-sorted matrices and deterministic links back to tx order", () => {
    const inputValues = [10, 30, 20]; // sorted: 30 (i1), 20 (i2), 10 (i0)
    const outputValues = [5, 50]; // sorted: 50 (o1), 5 (o0)
    // Sorted-space matrix: row 0 = output 50, row 1 = output 5; cols = inputs 30, 20, 10
    const sorted = [
      [0.9, 0.2, 0.1],
      [0.1, 0.8, 1.0],
    ];
    const r = toSubmittedOrder(
      {
        matLnkProbabilities: sorted,
        matLnkCombinations: sorted.map((row) => row.map((p) => p * 10)),
        deterministicLinks: [[1, 2]], // output 5 <- input 10 in sorted space
      } as unknown as BoltzmannWorkerResult,
      inputValues,
      outputValues,
    );
    // tx order: row o0 (5), row o1 (50); cols i0 (10), i1 (30), i2 (20)
    expect(r.matLnkProbabilities).toEqual([
      [1.0, 0.1, 0.8],
      [0.1, 0.9, 0.2],
    ]);
    expect(r.matLnkCombinations[0]).toEqual([10, 1, 8]);
    expect(r.deterministicLinks).toEqual([[0, 0]]);
  });

  it("keeps tx order among equal values (stable, like Rust sort_by)", () => {
    const r = toSubmittedOrder(
      { matLnkProbabilities: [[0.5, 0.25]], matLnkCombinations: [[2, 1]], deterministicLinks: [] } as unknown as BoltzmannWorkerResult,
      [7, 7],
      [14],
    );
    expect(r.matLnkProbabilities).toEqual([[0.5, 0.25]]);
  });

  it("leaves degenerate results whose shape does not match untouched", () => {
    const degenerate = { matLnkProbabilities: [[1]], matLnkCombinations: [[1]], deterministicLinks: [] } as unknown as BoltzmannWorkerResult;
    expect(toSubmittedOrder(degenerate, [3, 2], [4, 1])).toBe(degenerate);
  });
});

describe("expandMatrixToTx", () => {
  it("re-indexes rows by vout and columns by vin, zeroing OP_RETURN and coinbase", async () => {
    const { expandMatrixToTx } = await import("../boltzmann-detection");
    const tx = {
      vin: [{ prevout: { value: 5 } }, { prevout: { value: 7 } }],
      vout: [{ scriptpubkey_type: "op_return", scriptpubkey: "6a00", value: 0 }, { value: 4 }, { value: 6 }],
    };
    const r = expandMatrixToTx({ matLnkProbabilities: [[0.1, 0.9], [0.3, 0.7]], matLnkCombinations: [[1, 9], [3, 7]], deterministicLinks: [[1, 0]] as [number, number][] }, tx);
    expect(r.matLnkProbabilities).toEqual([[0, 0], [0.1, 0.9], [0.3, 0.7]]);
    expect(r.deterministicLinks).toEqual([[2, 0]]);
  });
});
