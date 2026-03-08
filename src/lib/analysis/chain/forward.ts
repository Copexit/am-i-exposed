import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import { analyzeCoinJoin, isCoinJoinFinding } from "../heuristics/coinjoin";

/**
 * Forward chain analysis: examine what happened to outputs after this tx.
 * Detects common privacy mistakes in post-spend behavior.
 */

export interface ForwardAnalysisResult {
  findings: Finding[];
  /** Outputs that were consolidated post-CoinJoin (output indices) */
  consolidatedCoinJoinOutputs: number[];
  /** Outputs that are part of a forward peel chain */
  peelChainOutputs: number[];
  /** Outputs where toxic change was merged with post-mix UTXOs */
  toxicMergeOutputs: number[];
}

/**
 * Analyze output spending behavior for privacy mistakes.
 */
export function analyzeForward(
  tx: MempoolTransaction,
  outspends: MempoolOutspend[],
  childTxs: Map<number, MempoolTransaction>,
): ForwardAnalysisResult {
  const findings: Finding[] = [];
  const consolidatedCoinJoinOutputs: number[] = [];
  const peelChainOutputs: number[] = [];
  const toxicMergeOutputs: number[] = [];

  const txIsCoinJoin = analyzeCoinJoin(tx).findings.some(isCoinJoinFinding);

  // Check each spent output
  for (const [outputIdx, childTx] of childTxs.entries()) {
    if (!childTx) continue;
    const outspend = outspends[outputIdx];
    if (!outspend?.spent) continue;

    // Item 1: Post-CoinJoin consolidation detection
    if (txIsCoinJoin && childTx.vin.length >= 2) {
      // Check if multiple CoinJoin outputs from this tx are consumed in the same child tx
      const sameParentInputs = childTx.vin.filter((vin) => vin.txid === tx.txid);
      if (sameParentInputs.length >= 2) {
        consolidatedCoinJoinOutputs.push(outputIdx);
      }
    }

    // Item 2: Forward peel chain detection
    // Peel chain pattern: 1 input, 2 outputs, one much larger than the other
    if (childTx.vin.length === 1 && childTx.vout.length === 2) {
      const spendable = childTx.vout.filter((o) => !o.scriptpubkey.startsWith("6a"));
      if (spendable.length === 2) {
        const [v1, v2] = [spendable[0].value, spendable[1].value];
        const ratio = Math.min(v1, v2) / Math.max(v1, v2);
        // Peel chain: one output is much smaller (change) - ratio < 0.3
        if (ratio < 0.3 && ratio > 0) {
          peelChainOutputs.push(outputIdx);
        }
      }
    }
  }

  // Item 3: Toxic change merged with post-mix UTXOs
  // Check if any child tx combines a tx0 toxic change with CoinJoin outputs
  // tx0 detection: OP_RETURN + multiple equal-value outputs (premix denomination)
  const hasOpReturn = tx.vout.some((o) => o.scriptpubkey.startsWith("6a"));
  const spendableVout = tx.vout.filter((o) => !o.scriptpubkey.startsWith("6a"));
  const valueCounts = new Map<number, number>();
  for (const o of spendableVout) valueCounts.set(o.value, (valueCounts.get(o.value) ?? 0) + 1);
  const hasEqualOutputs = [...valueCounts.values()].some((c) => c >= 2);
  const isTx0 = hasOpReturn && hasEqualOutputs && spendableVout.length >= 3;
  if (isTx0) {
    for (const [outputIdx, childTx] of childTxs.entries()) {
      if (!childTx || childTx.vin.length < 2) continue;

      // Check if child tx mixes tx0 change with post-mix outputs
      const hasThisTxInput = childTx.vin.some((v) => v.txid === tx.txid);
      const hasOtherInput = childTx.vin.some((v) => v.txid !== tx.txid);
      if (hasThisTxInput && hasOtherInput) {
        toxicMergeOutputs.push(outputIdx);
      }
    }
  }

  // Generate findings

  if (consolidatedCoinJoinOutputs.length > 0) {
    findings.push({
      id: "chain-post-coinjoin-consolidation",
      severity: "critical",
      title: "CoinJoin outputs were consolidated after mixing",
      description:
        "Multiple CoinJoin outputs from this transaction were spent together in a subsequent " +
        "transaction. This re-links them via common input ownership, completely undoing the " +
        "privacy benefit of the CoinJoin. This is the most common privacy mistake.",
      recommendation:
        "Never consolidate CoinJoin outputs. Spend each post-mix UTXO individually in separate " +
        "transactions. Use coin control to select a single UTXO per payment.",
      scoreImpact: -15,
      params: { consolidatedCount: consolidatedCoinJoinOutputs.length },
      confidence: "deterministic",
    });
  }

  if (peelChainOutputs.length > 0) {
    findings.push({
      id: "chain-forward-peel",
      severity: "high",
      title: "Peel chain continues forward from this transaction",
      description:
        "Change outputs from this transaction feed into further transactions with the " +
        "same pattern (1-in, 2-out, asymmetric values), forming a forward peel chain. " +
        "Each hop reveals the payment amount and change direction.",
      recommendation:
        "Break the peel chain pattern by using different transaction structures. " +
        "Consider PayJoin or STONEWALL for future payments.",
      scoreImpact: -5,
      params: { peelCount: peelChainOutputs.length },
      confidence: "high",
    });
  }

  if (toxicMergeOutputs.length > 0) {
    findings.push({
      id: "chain-toxic-merge",
      severity: "critical",
      title: "Toxic change merged with post-mix UTXOs",
      description:
        "Change from a CoinJoin premix (tx0) was spent in the same transaction as " +
        "post-mix CoinJoin outputs. This links the pre-mix identity to the mixed coins, " +
        "destroying all mixing benefit.",
      recommendation:
        "Never spend toxic change with post-mix UTXOs. Dispose of toxic change via " +
        "Monero atomic swap (UnstoppableSwap), Lightning channel opening, or submarine swap.",
      scoreImpact: -20,
      params: { mergeCount: toxicMergeOutputs.length },
      confidence: "deterministic",
    });
  }

  return { findings, consolidatedCoinJoinOutputs, peelChainOutputs, toxicMergeOutputs };
}

/**
 * Calculate output age in blocks for unspent output indicators.
 */
export function getOutputAge(
  tx: MempoolTransaction,
  currentBlockHeight: number,
): number | null {
  if (!tx.status.confirmed || !tx.status.block_height) return null;
  return currentBlockHeight - tx.status.block_height;
}
