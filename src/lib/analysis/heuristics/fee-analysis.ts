import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";

/**
 * H6: Fee Analysis
 *
 * Fee patterns can reveal wallet software:
 * - Round fee rates (exact sat/vB) suggest specific wallet implementations
 * - RBF signaling reveals replaceability intent
 * - Very high or very low fees can indicate specific behaviors
 *
 * Impact: -2 to -5
 */
export const analyzeFees: TxHeuristic = (tx) => {
  const findings: Finding[] = [];

  if (tx.fee === 0 || tx.weight === 0) return { findings };

  // Calculate fee rate in sat/vB
  const vsize = Math.ceil(tx.weight / 4);
  const feeRate = tx.fee / vsize;

  // Check for exact integer fee rate (common in some wallets)
  if (feeRate === Math.floor(feeRate) && feeRate > 0) {
    findings.push({
      id: "h6-round-fee-rate",
      severity: "low",
      title: `Exact fee rate: ${feeRate} sat/vB`,
      description:
        `This transaction uses an exact integer fee rate of ${feeRate} sat/vB. ` +
        "Some wallet software uses round fee rates rather than precise estimates, " +
        "which can help identify the wallet used.",
      recommendation:
        "This is a minor signal. Most modern wallets now use precise fee estimation.",
      scoreImpact: -2,
    });
  }

  // Check RBF signaling
  const hasRbf = tx.vin.some(
    (v) => !v.is_coinbase && v.sequence < 0xfffffffe,
  );

  if (hasRbf) {
    findings.push({
      id: "h6-rbf-signaled",
      severity: "low",
      title: "RBF (Replace-by-Fee) signaled",
      description:
        "This transaction signals RBF replaceability (nSequence < 0xfffffffe). " +
        "While RBF itself is not a privacy concern, it reveals that the sender's wallet supports fee bumping, " +
        "which narrows down the wallet software used.",
      recommendation:
        "RBF is generally recommended for fee management. As more wallets adopt it, this signal becomes less identifying.",
      scoreImpact: -1,
    });
  }

  return { findings };
};
