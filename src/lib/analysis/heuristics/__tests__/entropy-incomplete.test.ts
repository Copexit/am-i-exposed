import { describe, it, expect } from "vitest";
import { analyzeEntropy } from "../entropy";
import { makeTx, makeVin, makeVout, makeOpReturnVout } from "./fixtures/tx-factory";

describe("analyzeEntropy - incomplete data", () => {
  it("emits nothing when a non-coinbase prevout is missing", () => {
    // Would otherwise be reported as a 1-in/1-out h5-zero-entropy instead of a 2-input sweep
    const tx = makeTx({ vin: [makeVin(), makeVin({ prevout: null })], vout: [makeVout({ value: 150_000 })] });
    expect(analyzeEntropy(tx).findings).toEqual([]);
  });

  it("emits nothing when there are no valued outputs (OP_RETURN burn)", () => {
    const tx = makeTx({ vin: [makeVin()], vout: [makeOpReturnVout()] });
    expect(analyzeEntropy(tx).findings).toEqual([]);
  });
});
