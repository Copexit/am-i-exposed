import { describe, it, expect } from "vitest";
import type { Finding } from "@/lib/types";
import type { BoltzmannWorkerResult } from "../boltzmann-pool";
import { enhanceEntropyFinding } from "../boltzmann-enhance";

const wasm = (nInputs: number, nOutputs: number): BoltzmannWorkerResult => ({
  type: "result", id: "t", matLnkCombinations: [], matLnkProbabilities: [],
  nbCmbn: 64, entropy: 6, efficiency: 0, nbCmbnPrfctCj: 0, deterministicLinks: [],
  timedOut: false, elapsedMs: 1, nInputs, nOutputs, fees: 0, intraFeesMaker: 0, intraFeesTaker: 0,
});

const entropyFinding = (nUtxos: number): Finding => ({
  id: "h5-low-entropy", severity: "medium", confidence: "medium", title: "t", description: "d",
  recommendation: "r", scoreImpact: -3, params: { entropy: 0, method: "exact enumeration", nUtxos },
});

describe("enhanceEntropyFinding", () => {
  it("replaces the JS estimate when WASM ran on the same UTXO set", () => {
    const findings = [entropyFinding(4)];
    enhanceEntropyFinding(findings, wasm(2, 2));
    expect(findings[0].scoreImpact).toBe(12);
  });

  it("keeps the address-merged JS score when WASM counted per-UTXO", () => {
    // 3 inputs from 2 addresses: the JS score merged them into 2 parties
    const findings = [entropyFinding(4)];
    enhanceEntropyFinding(findings, wasm(3, 2));
    expect(findings[0].scoreImpact).toBe(-3);
  });
});
