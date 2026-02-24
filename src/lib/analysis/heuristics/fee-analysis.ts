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
  // Exclude low rates (1-5 sat/vB) since these are common during low-fee periods
  // and being in a large cohort is actually privacy-neutral
  // Check if fee rate is close to an integer (vsize ceiling can cause slight deviation)
  const roundedFeeRate = Math.round(feeRate);
  if (Math.abs(feeRate - roundedFeeRate) < 0.05 && roundedFeeRate > 5) {
    findings.push({
      id: "h6-round-fee-rate",
      severity: "low",
      title: `Exact fee rate: ${roundedFeeRate} sat/vB`,
      params: { feeRate: roundedFeeRate },
      description:
        `This transaction uses an exact integer fee rate of ${roundedFeeRate} sat/vB. ` +
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
        "RBF is now standard across virtually all modern wallet software and is no longer a meaningful fingerprinting signal.",
      recommendation:
        "RBF is standard practice. Nearly all wallets signal RBF by default, so this reveals very little about the sender.",
      scoreImpact: 0,
    });
  }

  return { findings };
};
