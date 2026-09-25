/**
 * Enhance the H5 entropy finding with real WASM Boltzmann results.
 * Replaces the JS-side approximate entropy with the exact WASM computation.
 */

import type { Finding } from "@/lib/types";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";
import { isCoinJoinFinding } from "@/lib/analysis/heuristics/coinjoin";
import { fmtN, roundTo } from "@/lib/format";
import type { FindingId } from "@/lib/analysis/finding-metadata";

/** Method label and accuracy qualifier for the entropy finding. */
function getMethodInfo(b: BoltzmannWorkerResult): { label: string; isApprox: boolean } {
  switch (b.method) {
    case "wabisabi":
      return { label: "tier-decomposed Boltzmann", isApprox: true };
    case "joinmarket":
      return { label: "JoinMarket Boltzmann", isApprox: true };
    default:
      return { label: "WASM Boltzmann", isApprox: false };
  }
}

/** Method label of the JS entropy when it is only a lower bound. */
const LOWER_BOUND = "lower-bound estimate";

/** Finding IDs that should NOT be overridden (structurally deterministic). */
const SKIP_IDS = new Set<FindingId>([
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
  const existing = findings[idx];
  if (!existing || SKIP_IDS.has(existing.id)) return;

  const nUtxos = boltzmann.nInputs + boltzmann.nOutputs;
  // H5 merges UTXOs sharing an address (Boltzmann MERGE_INPUTS/MERGE_OUTPUTS),
  // while the WASM matrix stays per-UTXO so its rows/cols map to vin/vout.
  // When the UTXO counts differ, the WASM entropy counts one owner's coins as
  // separate parties, so the merged score stands. The JS one-to-one
  // enumeration is only a lower bound of Boltzmann's many-to-many count (it
  // can say 0 bits where Boltzmann finds ambiguity), so it is labelled as one.
  // ponytail: a second WASM run on address-merged values would give the exact
  // merged entropy; add it if shared-address txs need the exact score.
  if (existing.params?.nUtxos !== nUtxos) {
    const method = existing.params?.method;
    if (method === "exact enumeration") {
      findings[idx] = {
        ...existing,
        params: { ...existing.params, method: LOWER_BOUND },
        description: existing.description.replace(`via ${method}`, `via ${LOWER_BOUND}`),
      };
    }
    return;
  }

  const entropyBits = boltzmann.entropy;
  const roundedEntropy = Math.round(entropyBits * 100) / 100;

  // Same scaling as entropy.ts line 186
  const impact = entropyBits < 1 ? 0 : entropyBits < 2 ? 2 : Math.min(Math.floor(entropyBits * 2), 15);

  const interpretationsStr = entropyBits > 40
    ? `~2^${Math.round(entropyBits)}`
    : fmtN(boltzmann.nbCmbn);

  // Efficiency is only meaningful for CoinJoin transactions
  const isCJ = findings.some(isCoinJoinFinding);

  const { label: methodLabel, isApprox } = getMethodInfo(boltzmann);
  const boundNote = isApprox ? " (upper bound)" : "";

  const params: Record<string, string | number> = {
    entropy: roundedEntropy,
    method: methodLabel,
    interpretations: boltzmann.nbCmbn,
    context: entropyBits >= 4 ? "high" : "low",
    entropyPerUtxo: roundTo(entropyBits / nUtxos),
    nUtxos,
    deterministicLinks: boltzmann.deterministicLinks.length,
  };
  if (isCJ && boltzmann.efficiency > 0) {
    params.efficiency = roundTo(Math.min(boltzmann.efficiency, 1) * 100, 2);
  }

  findings[idx] = {
    ...existing,
    // nbCmbn > 1: a JS "h5-low-entropy" estimate no longer applies
    id: "h5-entropy",
    severity: impact >= 10 ? "good" : impact >= 5 ? "low" : impact > 0 ? "low" : "medium",
    title: `Transaction entropy: ${roundedEntropy} bits${boundNote}`,
    params,
    description:
      `This transaction has ${roundedEntropy} bits of entropy (via ${methodLabel}${boundNote}), meaning there are ` +
      (isApprox ? "approximately " : "") +
      `${interpretationsStr} ` +
      (isApprox ? "possible" : "valid") +
      ` interpretations of the fund flow. ` +
      `Higher entropy makes chain analysis less reliable. ` +
      `Entropy per UTXO: ${roundTo(entropyBits / nUtxos)} bits${boundNote} (${nUtxos} UTXOs).` +
      (boltzmann.deterministicLinks.length > 0
        ? ` ${boltzmann.deterministicLinks.length} deterministic link${boltzmann.deterministicLinks.length > 1 ? "s" : ""} detected (100% probability).`
        : ""),
    scoreImpact: impact,
  };
}
