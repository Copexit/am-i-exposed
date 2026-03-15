/**
 * Enhance the H5 entropy finding with real WASM Boltzmann results.
 * Replaces the JS-side approximate entropy with the exact WASM computation.
 */

import type { Finding } from "@/lib/types";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";
import { fmtN, roundTo } from "@/lib/format";

/** Finding IDs that should NOT be overridden (structurally deterministic). */
const SKIP_IDS = new Set([
  "h5-zero-entropy",
  "h5-zero-entropy-sweep",
]);

/**
 * Enhance the entropy finding in-place with real Boltzmann data.
 * Mutates the findings array by replacing the existing entropy finding.
 */
export function enhanceEntropyFinding(
  findings: Finding[],
  boltzmann: BoltzmannWorkerResult,
): void {
  if (boltzmann.nbCmbn <= 1) return;

  const idx = findings.findIndex(f =>
    f.id === "h5-entropy" || f.id === "h5-low-entropy",
  );
  if (idx === -1) return;

  const existing = findings[idx];
  if (SKIP_IDS.has(existing.id)) return;

  const entropyBits = boltzmann.entropy;
  const roundedEntropy = Math.round(entropyBits * 100) / 100;
  const nUtxos = boltzmann.nInputs + boltzmann.nOutputs;

  // Same scaling as entropy.ts line 186
  const impact = entropyBits < 1 ? 0 : entropyBits < 2 ? 2 : Math.min(Math.floor(entropyBits * 2), 15);

  const interpretationsStr = entropyBits > 40
    ? `~2^${Math.round(entropyBits)}`
    : fmtN(boltzmann.nbCmbn);

  findings[idx] = {
    ...existing,
    severity: impact >= 10 ? "good" : impact >= 5 ? "low" : impact > 0 ? "low" : "medium",
    title: `Transaction entropy: ${roundedEntropy} bits`,
    params: {
      entropy: roundedEntropy,
      method: "WASM Boltzmann",
      interpretations: boltzmann.nbCmbn,
      context: entropyBits >= 4 ? "high" : "low",
      entropyPerUtxo: roundTo(entropyBits / nUtxos),
      nUtxos,
      deterministicLinks: boltzmann.deterministicLinks.length,
      efficiency: roundTo(boltzmann.efficiency * 100, 2),
    },
    description:
      `This transaction has ${roundedEntropy} bits of entropy (via WASM Boltzmann), meaning there are ` +
      `${interpretationsStr} valid interpretations of the fund flow. ` +
      `Higher entropy makes chain analysis less reliable. ` +
      `Entropy per UTXO: ${roundTo(entropyBits / nUtxos)} bits (${nUtxos} UTXOs).` +
      (boltzmann.deterministicLinks.length > 0
        ? ` ${boltzmann.deterministicLinks.length} deterministic link${boltzmann.deterministicLinks.length > 1 ? "s" : ""} detected (100% probability).`
        : ""),
    scoreImpact: impact,
  };
}
