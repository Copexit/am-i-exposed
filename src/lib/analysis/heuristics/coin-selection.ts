import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";

/**
 * Coin Selection Pattern Detection
 *
 * Detect FIFO, LIFO, and BnB (Branch and Bound) patterns:
 * - BnB: changeless transactions (Bitcoin Core uses BnB to find exact-match input sets)
 * - FIFO: inputs ordered oldest-first by confirmation height
 * - LIFO: inputs ordered newest-first by confirmation height
 *
 * These patterns fingerprint specific wallet software.
 */
export const analyzeCoinSelection: TxHeuristic = (tx) => {
  const findings: Finding[] = [];

  // Need at least 1 input and filter out coinbase
  const nonCoinbase = tx.vin.filter((v) => !v.is_coinbase);
  if (nonCoinbase.length === 0) return { findings };

  // Check for BnB (Branch and Bound) pattern: changeless transaction
  // BnB tries to find an exact-match input set that avoids creating change
  const spendable = tx.vout.filter((o) => !o.scriptpubkey.startsWith("6a"));
  if (spendable.length === 1 && nonCoinbase.length >= 2) {
    // Multiple inputs, single output (no change) = likely BnB
    findings.push({
      id: "h-coin-selection-bnb",
      severity: "good",
      title: "Changeless transaction (possible Branch-and-Bound selection)",
      description:
        "This transaction has multiple inputs but no change output. This is consistent " +
        "with Branch-and-Bound (BnB) coin selection, which finds input combinations that " +
        "exactly match the payment amount plus fee. BnB is used by Bitcoin Core and " +
        "Sparrow. Changeless transactions are better for privacy since there is no " +
        "change output to link back to the sender.",
      recommendation:
        "Changeless transactions are good for privacy. Continue using wallets with " +
        "BnB coin selection when possible.",
      scoreImpact: 3,
      params: { inputCount: nonCoinbase.length },
      confidence: "medium",
    });
  }

  // For FIFO/LIFO detection, we need input confirmation heights
  // We can only check this if inputs have prevout data (not raw tx analysis)
  // Use sequence numbers and prevout data as proxy
  if (nonCoinbase.length >= 3) {
    // We don't have direct confirmation heights for inputs, but we can
    // check input values for patterns that suggest algorithmic selection
    const values = nonCoinbase.map((v) => v.prevout?.value ?? 0).filter((v) => v > 0);

    if (values.length >= 3) {
      // Check if inputs are sorted by value (ascending or descending)
      const ascending = values.every((v, i) => i === 0 || v >= values[i - 1]);
      const descending = values.every((v, i) => i === 0 || v <= values[i - 1]);

      if (ascending && !descending) {
        findings.push({
          id: "h-coin-selection-value-asc",
          severity: "low",
          title: "Inputs ordered by ascending value",
          description:
            "Inputs are sorted from smallest to largest value. This ordering pattern " +
            "may indicate specific coin selection behavior (smallest-first). Some wallets " +
            "use this approach to minimize the number of inputs needed.",
          recommendation:
            "Input ordering can fingerprint wallet software. Consider using wallets with " +
            "randomized input ordering for better privacy.",
          scoreImpact: -1,
          params: { inputCount: values.length },
          confidence: "low",
        });
      } else if (descending && !ascending) {
        findings.push({
          id: "h-coin-selection-value-desc",
          severity: "low",
          title: "Inputs ordered by descending value",
          description:
            "Inputs are sorted from largest to smallest value. This ordering pattern " +
            "may indicate largest-first coin selection, which is used by some wallet " +
            "implementations to minimize the total number of inputs.",
          recommendation:
            "Input ordering can fingerprint wallet software. Consider using wallets with " +
            "randomized input ordering for better privacy.",
          scoreImpact: -1,
          params: { inputCount: values.length },
          confidence: "low",
        });
      }
    }
  }

  return { findings };
};
