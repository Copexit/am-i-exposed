import { describe, it, expect } from "vitest";
import { AnalysisAPI, createAnalysisAPI } from "../analysis-api";

// PSBT test vector: 1 input (100000 sats), 1 output (90000 sats), fee 10000
// prettier-ignore
const PSBT_COMPLETE = "cHNidP8BAFICAAAAAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAAAAAAD/////AZBfAQAAAAAAFgAUzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc0AAAAAAAEBH6CGAQAAAAAAFgAUq6urq6urq6urq6urq6urq6urq6sAAA==";

describe("AnalysisAPI", () => {
  it("can be instantiated with defaults", () => {
    const api = new AnalysisAPI();
    expect(api).toBeDefined();
  });

  it("can be created via factory function", () => {
    const api = createAnalysisAPI({ network: "testnet4" });
    expect(api).toBeDefined();
  });

  it("analyzePSBT runs heuristics on a PSBT", async () => {
    const api = new AnalysisAPI();
    const result = await api.analyzePSBT(PSBT_COMPLETE);

    expect(result.scoring).toBeDefined();
    expect(result.scoring.score).toBeGreaterThanOrEqual(0);
    expect(result.scoring.score).toBeLessThanOrEqual(100);
    expect(result.scoring.grade).toBeDefined();
    expect(result.scoring.findings).toBeDefined();

    expect(result.psbt.inputCount).toBe(1);
    expect(result.psbt.outputCount).toBe(1);
    expect(result.psbt.fee).toBe(10_000);
  });

  it("suggestCoinSelection returns a valid selection", () => {
    const api = new AnalysisAPI();
    const utxos = [
      { txid: "a".repeat(64), vout: 0, value: 50_000 },
      { txid: "b".repeat(64), vout: 0, value: 100_000 },
      { txid: "c".repeat(64), vout: 1, value: 200_000 },
    ];

    const result = api.suggestCoinSelection(utxos, 90_000, 2);
    expect(result).not.toBeNull();
    expect(result!.selected.length).toBeGreaterThan(0);
    expect(result!.inputTotal).toBeGreaterThanOrEqual(90_000);
    expect(result!.findings.length).toBeGreaterThan(0);
  });

  it("suggestCoinSelection returns null for impossible amounts", () => {
    const api = new AnalysisAPI();
    const utxos = [
      { txid: "a".repeat(64), vout: 0, value: 1_000 },
    ];

    const result = api.suggestCoinSelection(utxos, 1_000_000, 1);
    expect(result).toBeNull();
  });
});
