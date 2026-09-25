import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import { isCoinJoinTx } from "../heuristics/coinjoin";
import { getSpendableOutputs, countOutputValues } from "../heuristics/tx-utils";
import { truncateId } from "@/lib/constants";
import { detectTx0 } from "../heuristics/coinjoin-premix";
import { fmtN } from "@/lib/format";

/**
 * Permissive CoinJoin check for suppression only. Catches edge-case remixes
 * that `isCoinJoinTx` misses (fewer participants, sub-10k denoms, etc.).
 * Errs on the side of suppression to avoid false consolidation accusations.
 */
function isLikelyCoinJoinTx(tx: MempoolTransaction): boolean {
  const spendable = getSpendableOutputs(tx.vout);
  const distinctParents = new Set(tx.vin.map((v) => v.txid));

  // Signal 1: 5+ distinct input sources + 5+ outputs = multi-party
  if (distinctParents.size >= 5 && spendable.length >= 5) return true;

  // Signal 2: 3+ distinct sources + equal-value output group
  if (distinctParents.size >= 3 && spendable.length >= 3) {
    const counts = countOutputValues(spendable);
    if ([...counts.values()].some((c) => c >= 2)) return true;
  }

  return false;
}

/**
 * Forward chain analysis: examine what happened to outputs after this tx.
 * Detects common privacy mistakes in post-spend behavior.
 */

interface ForwardAnalysisResult {
  findings: Finding[];
  /** Outputs that were consolidated post-CoinJoin (output indices) */
  consolidatedCoinJoinOutputs: number[];
  /** Outputs that are part of a forward peel chain */
  peelChainOutputs: number[];
  /** Outputs where tx0 toxic change was spent together with other UTXOs */
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

  const txIsCoinJoin = isCoinJoinTx(tx);

  // Track consolidation groups: which child tx consumed which outputs
  const consolidationGroups = new Map<string, number[]>();

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
        // If the child tx is itself a CoinJoin (or likely one), this is a remix - not consolidation
        const childIsCoinJoin = isCoinJoinTx(childTx) || isLikelyCoinJoinTx(childTx);
        if (!childIsCoinJoin) {
          consolidatedCoinJoinOutputs.push(outputIdx);
          // Group by child tx for detailed reporting
          const group = consolidationGroups.get(childTx.txid) ?? [];
          group.push(outputIdx);
          consolidationGroups.set(childTx.txid, group);
        }
      }
    }

    // Item 2: Forward peel chain detection
    // Peel chain pattern: 1 input, 2 outputs, one much larger than the other
    // Skip when parent tx is a CoinJoin: post-mix outputs spent individually
    // (1-in, 2-out) is normal and expected behavior, not a peel chain.
    if (!txIsCoinJoin && childTx.vin.length === 1 && childTx.vout.length === 2) {
      const [out1, out2] = getSpendableOutputs(childTx.vout);
      if (out1 && out2) {
        const [v1, v2] = [out1.value, out2.value];
        const ratio = Math.min(v1, v2) / Math.max(v1, v2);
        // Peel chain: one output is much smaller (change) - ratio < 0.3
        if (ratio < 0.3 && ratio > 0) {
          peelChainOutputs.push(outputIdx);
        }
      }
    }
  }

  // Item 3: Toxic change spent together with other UTXOs
  // Only the toxic change output counts: premix outputs are supposed to be
  // spent alongside other participants' inputs in the Whirlpool mix. Whether
  // the other inputs are post-mix is not known here (their parents are not
  // fetched), so the finding claims only the merge itself.
  const toxicChange = detectTx0(tx)?.toxicChange;
  if (toxicChange) {
    for (const [outputIdx, childTx] of childTxs.entries()) {
      if (tx.vout[outputIdx] !== toxicChange) continue;
      if (!outspends[outputIdx]?.spent) continue;
      if (!childTx || childTx.vin.length < 2) continue;

      const hasThisTxInput = childTx.vin.some((v) => v.txid === tx.txid);
      const hasOtherInput = childTx.vin.some((v) => v.txid !== tx.txid);
      if (hasThisTxInput && hasOtherInput) {
        toxicMergeOutputs.push(outputIdx);
      }
    }
  }

  // Generate findings

  if (consolidatedCoinJoinOutputs.length > 0) {
    // Build detailed description showing which outputs were consolidated and where
    const groupDetails: string[] = [];
    for (const [childTxid, indices] of consolidationGroups) {
      const outputList = indices.map((i) => {
        const value = tx.vout[i]?.value ?? 0;
        return `#${i} (${fmtN(value)} sats)`;
      }).join(", ");
      groupDetails.push(
        `Outputs ${outputList} were spent together in tx ${truncateId(childTxid, 6)}`,
      );
    }

    // Serialize consolidation groups for structured display in the finding card
    const serializedGroups: { childTxid: string; outputs: { index: number; value: number }[] }[] = [];
    for (const [childTxid, indices] of consolidationGroups) {
      serializedGroups.push({
        childTxid,
        outputs: indices.map((i) => ({ index: i, value: tx.vout[i]?.value ?? 0 })),
      });
    }

    findings.push({
      id: "chain-post-coinjoin-consolidation",
      severity: "critical",
      title: "CoinJoin outputs were consolidated after mixing",
      description:
        "Multiple CoinJoin outputs were spent together, re-linking them via common input " +
        "ownership and undoing the mixing. " + groupDetails.join(". ") + ".",
      recommendation:
        "Never consolidate CoinJoin outputs. Spend each post-mix UTXO individually in separate " +
        "transactions. Use coin control to select a single UTXO per payment.",
      scoreImpact: -15,
      params: {
        consolidatedCount: consolidatedCoinJoinOutputs.length,
        consolidatedIndices: consolidatedCoinJoinOutputs.join(","),
        childTxid: [...consolidationGroups.keys()][0] ?? "",
        _consolidationGroups: JSON.stringify(serializedGroups),
      },
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
      title: "Toxic change spent together with other UTXOs",
      description:
        "Change from a CoinJoin premix (tx0) was spent in the same transaction as " +
        "other UTXOs. This links the pre-mix identity to those coins; if any of them " +
        "are post-mix outputs, their mixing benefit is lost.",
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
