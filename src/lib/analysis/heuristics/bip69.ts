import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import { isCoinbase } from "./tx-utils";

/**
 * BIP69: Lexicographic Input/Output Ordering Detection
 *
 * BIP69 specifies that inputs and outputs should be sorted lexicographically
 * to reduce wallet fingerprinting. However, BIP69 itself has become a
 * fingerprint: only specific wallets implement it (Electrum, old Samourai).
 *
 * Detection:
 * - Check if inputs are sorted by txid:vout (lexicographic)
 * - Check if outputs are sorted by value:scriptpubkey (lexicographic)
 * - If both are sorted: BIP69 compliant (Electrum/Samourai signal)
 * - If neither: random ordering (Bitcoin Core, most modern wallets)
 *
 * Impact: -2 (fingerprints wallet software)
 */
/**
 * Check if inputs and outputs follow BIP69 lexicographic ordering.
 * BIP69: inputs sorted by txid then vout, outputs sorted by value then scriptpubkey.
 *
 * Shared utility used by both the BIP69 heuristic and wallet fingerprinting.
 */
export function checkBip69Ordering(
  tx: { vin: Array<{ txid: string; vout: number }>; vout: Array<{ value: number; scriptpubkey: string }> },
): boolean {
  // Check input ordering: sorted by txid (ascending), then vout (ascending)
  for (let i = 1; i < tx.vin.length; i++) {
    const prev = tx.vin[i - 1];
    const curr = tx.vin[i];
    if (prev.txid > curr.txid) return false;
    if (prev.txid === curr.txid && prev.vout > curr.vout) return false;
  }

  // Check output ordering: sorted by value (ascending), then scriptpubkey (ascending)
  for (let i = 1; i < tx.vout.length; i++) {
    const prev = tx.vout[i - 1];
    const curr = tx.vout[i];
    if (prev.value > curr.value) return false;
    if (prev.value === curr.value && prev.scriptpubkey > curr.scriptpubkey) return false;
  }

  return true;
}

export const analyzeBip69: TxHeuristic = (tx) => {
  const findings: Finding[] = [];

  // Need at least 2 inputs or 2 outputs to detect ordering
  if (tx.vin.length < 2 && tx.vout.length < 2) return { findings };
  if (isCoinbase(tx)) return { findings };

  const spendable = tx.vout.filter((o) => o.value > 0);
  const isBip69 = checkBip69Ordering(tx);

  if (isBip69 && tx.vin.length >= 2 && spendable.length >= 2) {
    findings.push({
      id: "bip69-detected",
      severity: "low",
      confidence: "low",
      title: "BIP69 lexicographic ordering detected",
      params: { inputsSorted: 1, outputsSorted: 1 },
      description:
        "Inputs and outputs follow BIP69 lexicographic ordering. " +
        "This ordering scheme was designed to reduce fingerprinting, but in practice it identifies " +
        "specific wallet software (Electrum, older Samourai/Ashigaru versions). " +
        "Most modern wallets use random ordering instead.",
      recommendation:
        "BIP69 ordering can fingerprint your wallet software. " +
        "Consider using a wallet with random input/output ordering for better privacy.",
      scoreImpact: -2,
    });
  }

  return { findings };
};
