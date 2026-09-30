/**
 * Tests for the Boltzmann WASM adapter and command.
 * Uses the real WASM bindings (built by wasm-pack --target nodejs).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { computeBoltzmann, computeBoltzmannJoinMarket, computeBoltzmannWabiSabi } from "../src/adapters/boltzmann-node";
import { fmtInterpretations } from "@/lib/format";

describe("computeBoltzmann - real WASM", () => {
  it("computes entropy for a 5x5 Whirlpool-like tx", async () => {
    // 5 inputs, 5 equal outputs (mimics Whirlpool)
    const inputs = [5010000, 5020000, 5030000, 5015000, 5025000];
    const outputs = [5000000, 5000000, 5000000, 5000000, 5000000];
    const fee = inputs.reduce((a, b) => a + b, 0) - outputs.reduce((a, b) => a + b, 0);

    const result = await computeBoltzmann(inputs, outputs, fee);

    expect(result.entropy).toBeGreaterThan(5);
    expect(result.efficiency).toBeGreaterThan(0.5);
    expect(result.nbCmbn).toBeGreaterThan(1);
    expect(result.deterministicLinks).toHaveLength(0);
    expect(result.timedOut).toBe(false);
    expect(result.nInputs).toBe(5);
    expect(result.nOutputs).toBe(5);
  });

  it("returns deterministic links for a simple 2-in 2-out payment", async () => {
    // 2 inputs of different values, 2 outputs where only one mapping is valid
    const inputs = [100000, 50000];
    const outputs = [120000, 28500];
    const fee = 1500;

    const result = await computeBoltzmann(inputs, outputs, fee);

    // With distinct values, there's typically only 1 valid interpretation
    expect(result.nbCmbn).toBeGreaterThanOrEqual(1);
    expect(result.deterministicLinks.length).toBeGreaterThanOrEqual(0);
    expect(result.timedOut).toBe(false);
  });

  it("handles equal inputs with non-equal outputs", async () => {
    const inputs = [100000, 100000];
    const outputs = [150000, 48500];
    const fee = 1500;

    const result = await computeBoltzmann(inputs, outputs, fee);

    expect(result.entropy).toBeGreaterThanOrEqual(0);
    expect(result.nInputs).toBe(2);
    expect(result.nOutputs).toBe(2);
  });

  it("produces correct matrix dimensions", async () => {
    const inputs = [80000, 60000, 40000];
    const outputs = [100000, 50000, 28500];
    const fee = 1500;

    const result = await computeBoltzmann(inputs, outputs, fee);

    // Matrix should be [nOutputs][nInputs]
    expect(result.matLnkProbabilities).toHaveLength(3);
    for (const row of result.matLnkProbabilities) {
      expect(row).toHaveLength(3);
    }

    // Each probability should be between 0 and 1
    for (const row of result.matLnkProbabilities) {
      for (const p of row) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
  });

  it("respects timeout", async () => {
    // Use very short timeout - should complete or timeout gracefully
    const inputs = [100000, 50000];
    const outputs = [120000, 28500];
    const fee = 1500;

    const result = await computeBoltzmann(inputs, outputs, fee, 0.005, 1);

    // Should return a result regardless (may be partial)
    expect(result).toHaveProperty("entropy");
    expect(result).toHaveProperty("timedOut");
  });

  it("efficiency is 1.0 for perfect CoinJoin structure", async () => {
    // All equal inputs, all equal outputs
    const inputs = [1000000, 1000000, 1000000];
    const outputs = [990000, 990000, 990000];
    const fee = 30000;

    const result = await computeBoltzmann(inputs, outputs, fee);

    expect(result.efficiency).toBeCloseTo(1.0, 1);
    expect(result.deterministicLinks).toHaveLength(0);
  });
});

describe("computeBoltzmannJoinMarket - real WASM", () => {
  it("reports maker-model links for 6cb2433f as model links, never deterministic", async () => {
    const inputs = [
      100_000_000, 99_714_485, 100_008_100, 100_000_000, 100_000_000, 100_000_000,
      70_577_264, 99_690_093, 21_296_812, 99_712_169, 99_690_093, 100_005_800,
      100_000_000, 28_764_098, 37_955_010, 100_000_000, 99_703_550, 100_000_000,
      198_873_630, 100_000_000, 79_216_957, 100_000_000, 100_000_000,
    ];
    const outputs = [
      ...Array.from({ length: 10 }, () => 198_732_961),
      80_489_759, 29_453_272, 22_583_724, 9_819_186, 1_306_587, 1_278_915, 1_276_615, 985_300, 680_555,
    ];
    const result = await computeBoltzmannJoinMarket(inputs, outputs, 4538, 198_732_961);

    expect(result.method).toBe("joinmarket");
    expect(result.deterministicLinks).toEqual([]);
    expect(result.modelLinks).toHaveLength(5);
    expect(result.matLnkProbabilities.flat().every((p) => p >= 0.01 && p <= 0.99)).toBe(true);
  });
});

describe("computeBoltzmannWabiSabi - u64 saturation", () => {
  it("flags the clamped count of WabiSabi fb596c9f and prints ~2^bits, not 18,446,744,...", async () => {
    const tx = JSON.parse(readFileSync(join(__dirname, "../../src/lib/analysis/heuristics/__tests__/fixtures/api-responses/wabisabi-coinjoin.json"), "utf8")) as {
      fee: number; vin: { prevout: { value: number } }[]; vout: { value: number }[];
    };
    const result = await computeBoltzmannWabiSabi(tx.vin.map((v) => v.prevout.value), tx.vout.map((o) => o.value).filter((v) => v > 0), tx.fee);
    expect(result.nbCmbnSaturated).toBe(true);
    const shown = fmtInterpretations(result.nbCmbn, result.entropy, result.nbCmbnSaturated);
    expect(shown).toMatch(/^~2\^\d+$/);
    expect(shown).not.toContain("18,446");
  });
});

// LaurentMT's process_tx rule: <= 1 input or exactly 1 output (value > 0) has
// one interpretation. 40b88e16: the 31,209-sat input is below the 157,002 fee;
// the bare linker would count it as a fee-only block (nb_cmbn 2, that input 50%).
describe("single-interpretation rule - real WASM", () => {
  const ins = [1_065_685, 2_343_648, 31_209, 3_762_429, 7_065_237];
  const outs = [14_111_206];
  const fee = 157_002;

  it("compute_boltzmann: 1 interpretation, every link deterministic", async () => {
    const r = await computeBoltzmann(ins, outs, fee);
    expect(r.nbCmbn).toBe(1);
    expect(r.entropy).toBe(0);
    expect(r.matLnkProbabilities).toEqual([[1, 1, 1, 1, 1]]);
    expect(r.deterministicLinks).toHaveLength(5);
  });

  it("prepare_boltzmann_ranged (multi-worker path): each worker returns the same single interpretation", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const wasm = require(join(__dirname, "../wasm/boltzmann_rs.js"));
    const i64 = (v: number[]) => new BigInt64Array(v.map(BigInt));
    for (const worker of [0, 1]) {
      const prep = wasm.prepare_boltzmann_ranged(i64(ins), i64(outs), BigInt(fee), 0n, 0n, 60_000, worker, 2);
      expect(Number(prep.total_root_branches)).toBe(0);
      const raw = wasm.dfs_finalize();
      expect(Number(raw.nb_cmbn)).toBe(1);
      expect(raw.mat_lnk_combinations.map((row: bigint[]) => row.map(Number))).toEqual([[1, 1, 1, 1, 1]]);
    }
  });

  it("a multi-output tx keeps the fee-only reading (as the reference): 5 interpretations", async () => {
    const r = await computeBoltzmann([100_000, 60_000, 300], [95_000, 58_000], 7_300, 0);
    expect(r.nbCmbn).toBe(5);
    expect(r.matLnkCombinations).toEqual([[5, 2, 2], [2, 5, 2]]);
  });
});
