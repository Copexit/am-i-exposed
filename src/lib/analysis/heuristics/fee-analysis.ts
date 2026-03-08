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
      confidence: "medium",
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
      confidence: "deterministic",
      title: "RBF (Replace-by-Fee) signaled",
      description:
        "This transaction signals RBF replaceability (nSequence < 0xfffffffe). " +
        "RBF is now standard across virtually all modern wallet software and is no longer a meaningful fingerprinting signal.",
      recommendation:
        "RBF is standard practice. Nearly all wallets signal RBF by default, so this reveals very little about the sender.",
      scoreImpact: 0,
    });
  }

  // Check for fee rate anomaly: fee calculated for non-SegWit weight but tx uses SegWit
  const hasSegWitInputs = tx.vin.some(
    (v) => !v.is_coinbase && v.witness && v.witness.length > 0,
  );
  if (hasSegWitInputs) {
    // For SegWit txs, weight < size * 4. If fee appears calibrated to non-segwit,
    // the effective sat/vB would be higher than intended.
    const rawSize = tx.size;
    const segwitVsize = Math.ceil(tx.weight / 4);
    const nonSegwitFeeRate = tx.fee / rawSize;
    const segwitFeeRate = tx.fee / segwitVsize;

    // If the non-segwit rate looks like a round number but segwit rate doesn't,
    // the wallet likely calculates fees using non-segwit size
    const nonSegRounded = Math.abs(nonSegwitFeeRate - Math.round(nonSegwitFeeRate)) < 0.1;
    const segRounded = Math.abs(segwitFeeRate - Math.round(segwitFeeRate)) < 0.1;

    if (nonSegRounded && !segRounded && rawSize !== segwitVsize) {
      findings.push({
        id: "h6-fee-segwit-miscalc",
        severity: "low",
        title: "Fee appears calculated using non-SegWit weight",
        description:
          "This SegWit transaction has a fee rate that aligns to a round number when " +
          `calculated against raw byte size (${Math.round(nonSegwitFeeRate)} sat/byte) but not ` +
          `when calculated correctly against virtual size (${segwitFeeRate.toFixed(1)} sat/vB). ` +
          "This suggests the wallet may not account for the SegWit discount, fingerprinting it as older software.",
        recommendation:
          "Use a wallet that properly estimates fees using virtual bytes (vB). " +
          "Most modern wallets handle this correctly.",
        scoreImpact: -2,
        params: {
          rawFeeRate: Math.round(nonSegwitFeeRate),
          segwitFeeRate: Math.round(segwitFeeRate * 10) / 10,
        },
        confidence: "medium",
      });
    }
  }

  // Check for fee-in-amount: detect when fee appears to be subtracted from an output
  // rather than added on top. Fingerprints wallets with "send max" or incorrect fee handling.
  if (tx.vin.length === 1 && tx.vout.length === 1) {
    // Single-input single-output: total output + fee = input exactly (always true)
    // Nothing to detect here
  } else if (tx.vout.length === 2) {
    const spendable = tx.vout.filter((o) => !o.scriptpubkey.startsWith("6a"));
    if (spendable.length === 2) {
      // Check if either output amount + fee equals a round number
      // This would suggest the user intended to send a round amount but the wallet
      // subtracted the fee from the output instead of adding it
      for (const out of spendable) {
        const amountPlusFee = out.value + tx.fee;
        // Check if amount+fee is a round BTC value
        if (isRoundSatAmount(amountPlusFee) && !isRoundSatAmount(out.value)) {
          findings.push({
            id: "h6-fee-in-amount",
            severity: "low",
            title: "Fee appears subtracted from output amount",
            description:
              `An output of ${out.value.toLocaleString()} sats plus the fee ` +
              `(${tx.fee.toLocaleString()} sats) equals ${amountPlusFee.toLocaleString()} sats, ` +
              "which is a round amount. This suggests the wallet subtracted the fee from the " +
              "intended send amount rather than adding it on top.",
            recommendation:
              "This is a minor wallet fingerprint signal. Consider using a wallet that " +
              "calculates fees separately from the send amount.",
            scoreImpact: -1,
            params: {
              outputAmount: out.value,
              feeAmount: tx.fee,
              roundTotal: amountPlusFee,
            },
            confidence: "medium",
          });
          break; // only flag once
        }
      }
    }
  }

  return { findings };
};

/** Check if a sat amount is "round" (divisible by common BTC denominations) */
function isRoundSatAmount(sats: number): boolean {
  // Round BTC amounts: 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0 BTC
  const roundDenoms = [100_000, 500_000, 1_000_000, 5_000_000, 10_000_000, 50_000_000, 100_000_000];
  return roundDenoms.some((d) => sats % d === 0 && sats > 0);
}
