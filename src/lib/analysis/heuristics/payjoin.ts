import type { TxHeuristic } from "./types";

/**
 * PayJoin (P2EP) Detection
 *
 * PayJoin transactions have a distinctive pattern:
 * - 2+ inputs from different entities (payer and payee)
 * - The payee contributes an input, breaking CIOH
 * - Typically 2 outputs (payment already consolidated with payee's input)
 *
 * Detection heuristic: if one output address matches an input address
 * (payee received back to themselves) and there are inputs from multiple
 * address types or amounts that don't follow normal change patterns.
 *
 * PayJoin is privacy-positive because it deliberately breaks CIOH.
 *
 * Impact: informational (+3)
 */
export const analyzePayJoin: TxHeuristic = (tx) => {
  if (tx.vin.length < 2 || tx.vout.length < 2) return { findings: [] };

  // Collect input addresses
  const inputAddresses = new Set<string>();
  for (const vin of tx.vin) {
    if (vin.prevout?.scriptpubkey_address) {
      inputAddresses.add(vin.prevout.scriptpubkey_address);
    }
  }

  // Check if any output address matches an input address
  // This is characteristic of PayJoin where the payee contributes an input
  // and gets change back to a related address
  let outputMatchesInput = false;
  for (const vout of tx.vout) {
    if (vout.scriptpubkey_address && inputAddresses.has(vout.scriptpubkey_address)) {
      outputMatchesInput = true;
      break;
    }
  }

  if (!outputMatchesInput) return { findings: [] };

  // Additional PayJoin signals:
  // - Typically 2 inputs, 2 outputs
  // - Input amounts don't trivially explain outputs (unnecessary input heuristic)
  const isLikelyPayJoin =
    tx.vin.length === 2 &&
    tx.vout.length === 2 &&
    inputAddresses.size === 2;

  if (!isLikelyPayJoin) return { findings: [] };

  return {
    findings: [
      {
        id: "payjoin-detected",
        severity: "good",
        title: "Possible PayJoin (P2EP) transaction",
        description:
          "This transaction shows signs of a PayJoin: 2 inputs from different addresses with an output matching an input address. " +
          "PayJoin deliberately breaks the common-input-ownership heuristic (CIOH) by having the recipient contribute an input, " +
          "making chain analysis significantly harder.",
        recommendation:
          "PayJoin is one of the best privacy techniques available. It looks like a normal transaction but poisons chain analysis databases.",
        scoreImpact: 3,
      },
    ],
  };
};
