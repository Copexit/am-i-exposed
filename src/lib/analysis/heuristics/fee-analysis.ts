import type { TxHeuristic, TxContext } from "./types";
import type { Finding } from "@/lib/types";
import { fmtN, calcVsize } from "@/lib/format";
import { isRoundAmount } from "./round-amount";
import { isCoinbase, isOpReturn } from "./tx-utils";

/**
 * H6: Fee Analysis
 *
 * Fee patterns can reveal wallet software:
 * - Round fee rates (exact sat/vB) suggest specific wallet implementations
 * - RBF signaling reveals replaceability intent
 * - Very high or very low fees can indicate specific behaviors
 * - CPFP detection: child tx spending parent's change at elevated fee rate
 *
 * Impact: -2 to -5
 */
export const analyzeFees: TxHeuristic = (tx, _rawHex?, ctx?) => {
  const findings: Finding[] = [];

  if (tx.fee === 0 || tx.weight === 0) return { findings };

  // Calculate fee rate in sat/vB
  const vsize = calcVsize(tx.weight);
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
        "RBF is standard practice and reveals little about the sender. Note: if fee-bumped via RBF, comparing original and replacement transactions can reveal which output decreased (the change). For maximum privacy, set an adequate fee upfront to avoid the need for fee bumping.",
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
    const segwitVsize = calcVsize(tx.weight);
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
  if (tx.vout.length === 2) {
    const spendable = tx.vout.filter((o) => !isOpReturn(o.scriptpubkey));
    if (spendable.length === 2) {
      // Check if either output amount + fee equals a round number
      // This would suggest the user intended to send a round amount but the wallet
      // subtracted the fee from the output instead of adding it
      for (const out of spendable) {
        const amountPlusFee = out.value + tx.fee;
        // Check if amount+fee is a round BTC value
        if (isRoundAmount(amountPlusFee) && !isRoundAmount(out.value)) {
          findings.push({
            id: "h6-fee-in-amount",
            severity: "low",
            title: "Fee appears subtracted from output amount",
            description:
              `An output of ${fmtN(out.value)} sats plus the fee ` +
              `(${fmtN(tx.fee)} sats) equals ${fmtN(amountPlusFee)} sats, ` +
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

  // CPFP detection: single-input child spending parent's non-largest output at elevated fee rate
  detectCpfp(tx, ctx, findings);

  return { findings };
};

/** Detect CPFP fee bumping pattern. */
function detectCpfp(tx: Parameters<TxHeuristic>[0], ctx: TxContext | undefined, findings: Finding[]): void {
  if (!ctx?.parentTx) return;
  if (tx.vin.length !== 1) return;
  if (isCoinbase(tx)) return;

  const parentTx = ctx.parentTx;

  // Both must be confirmed, and child must be in the same block or the next block
  const childHeight = tx.status?.block_height;
  const parentHeight = parentTx.status?.block_height;
  if (!childHeight || !parentHeight) return;
  if (childHeight < parentHeight || childHeight > parentHeight + 1) return;

  // Fee rate comparison: child >= 2x parent
  const childVsize = calcVsize(tx.weight);
  const parentVsize = calcVsize(parentTx.weight);
  if (childVsize === 0 || parentVsize === 0) return;
  const childFeeRate = tx.fee / childVsize;
  const parentFeeRate = parentTx.fee / parentVsize;
  if (parentFeeRate <= 0 || childFeeRate < parentFeeRate * 2) return;

  // The spent output must NOT be the largest parent output (CPFP spends change, not payment)
  const spentOutputIndex = tx.vin[0].vout;
  const spentOutput = parentTx.vout[spentOutputIndex];
  if (!spentOutput) return;
  const largestValue = Math.max(...parentTx.vout.map((o) => o.value));
  if (spentOutput.value === largestValue) return;

  // Check if parent had RBF signaled
  const parentHadRbf = parentTx.vin.some(
    (v) => !v.is_coinbase && v.sequence < 0xfffffffe,
  );

  const description =
    `This transaction appears to be a CPFP (Child-Pays-For-Parent) fee bump. ` +
    `It spends output #${spentOutputIndex} of the parent transaction at ${Math.round(childFeeRate)} sat/vB ` +
    `(parent: ${Math.round(parentFeeRate)} sat/vB). The spent output is likely change, ` +
    `confirming which parent output was the payment.` +
    (parentHadRbf
      ? " The parent had RBF signaled but CPFP was used instead. Note that CPFP also reveals change by spending it as a child input."
      : "");

  findings.push({
    id: "h6-cpfp-detected",
    severity: "low",
    confidence: "medium",
    title: "CPFP fee bump detected",
    description,
    recommendation:
      "CPFP reveals which parent output is change by spending it as a child input. " +
      "RBF reveals change by showing which output value decreased in the replacement. " +
      "For privacy-sensitive transactions, set an adequate fee upfront to avoid fee bumping entirely.",
    scoreImpact: 0,
    params: {
      parentTxid: parentTx.txid,
      spentOutputIndex,
      parentFeeRate: Math.round(parentFeeRate * 10) / 10,
      childFeeRate: Math.round(childFeeRate * 10) / 10,
      parentHadRbf: parentHadRbf ? 1 : 0,
    },
  });
}

