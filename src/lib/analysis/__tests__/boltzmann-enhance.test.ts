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
    expect(findings[0]?.scoreImpact).toBe(12);
  });

  it("renames an upgraded low-entropy finding to h5-entropy", () => {
    const findings = [entropyFinding(4)];
    enhanceEntropyFinding(findings, wasm(2, 2));
    expect(findings[0]?.id).toBe("h5-entropy");
  });

  it("keeps the address-merged JS score when WASM counted per-UTXO", () => {
    // 3 inputs from 2 addresses: the JS score merged them into 2 parties
    const findings = [entropyFinding(4)];
    enhanceEntropyFinding(findings, wasm(3, 2));
    expect(findings[0]?.scoreImpact).toBe(-3);
  });

  it("labels the kept JS one-to-one count as a lower bound (Boltzmann may find more)", () => {
    const findings = [{ ...entropyFinding(4), description: "near-zero entropy (0 bits, via exact enumeration)." }];
    enhanceEntropyFinding(findings, wasm(3, 2));
    expect(findings[0]?.params?.method).toBe("lower-bound estimate");
    expect(findings[0]?.description).toContain("via lower-bound estimate");
  });

  it("keeps an exact merged method label (equal-output partition) as is", () => {
    const findings = [{ ...entropyFinding(4), params: { entropy: 1, method: "Boltzmann partition", nUtxos: 4 } }];
    enhanceEntropyFinding(findings, wasm(3, 2));
    expect(findings[0]?.params?.method).toBe("Boltzmann partition");
  });
});
