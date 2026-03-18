import type { Finding, ScoringResult } from "@/lib/types";
import { fmtN } from "@/lib/format";
import type {
  MempoolTransaction,
  MempoolAddress,
  MempoolUtxo,
} from "@/lib/api/types";
import type { HeuristicTranslator, TxContext } from "./heuristics/types";
import {
  analyzeRoundAmounts,
  analyzeChangeDetection,
  analyzeCioh,
  analyzeCoinJoin,
  analyzeEntropy,
  analyzeFees,
  analyzeOpReturn,
  analyzeAddressReuse,
  analyzeUtxos,
  analyzeAddressType,
  analyzeWalletFingerprint,
  analyzeAnonymitySet,
  analyzeTiming,
  analyzeScriptTypeMix,
  analyzeSpendingPattern,
  analyzeDustOutputs,
  analyzeCoinbase,
  analyzeMultisigDetection,
  analyzePeelChain,
  analyzeConsolidation,
  analyzeUnnecessaryInput,
  analyzeCoinJoinPremix,
  analyzeBip69,
  analyzeBip47Notification,
  analyzeExchangePattern,
  analyzeRecurringPayment,
  analyzeCoinSelection,
  analyzeWitnessData,
  analyzeHighActivityAddress,
  analyzePostMix,
  analyzeEntityDetection,
  analyzeRicochet,
} from "./heuristics";
import { analyzeTemporalCorrelation } from "./chain/temporal";
import { analyzeFingerprintEvolution } from "./chain/prospective";
import { calculateScore, sumImpact } from "@/lib/scoring/score";
import { matchEntitySync } from "./entity-filter/entity-match";
import { getEntity } from "./entities";
import { applyCrossHeuristicRules, classifyTransactionType } from "./cross-heuristic";

export { classifyTransactionType } from "./cross-heuristic";
export { analyzeTransactionsForAddress, analyzeDestination } from "./address-orchestrator";
export type { PreSendResult } from "./address-orchestrator";

/** Exposed for unit tests only. */
export const applyCrossHeuristicRulesForTest = applyCrossHeuristicRules;

export interface HeuristicStep {
  id: string;
  label: string;
  status: "pending" | "running" | "done";
  impact?: number; // cumulative score impact after this step completes
}

// --- Transaction heuristics ---

export const TX_HEURISTICS = [
  { id: "coinbase", label: "Coinbase detection", fn: analyzeCoinbase },
  { id: "h1", label: "Round amounts", fn: analyzeRoundAmounts },
  { id: "h2", label: "Change detection", fn: analyzeChangeDetection },
  { id: "h3", label: "Common input ownership", fn: analyzeCioh },
  { id: "h4", label: "CoinJoin detection", fn: analyzeCoinJoin },
  { id: "h5", label: "Transaction entropy", fn: analyzeEntropy },
  { id: "h6", label: "Fee fingerprinting", fn: analyzeFees },
  { id: "h7", label: "OP_RETURN metadata", fn: analyzeOpReturn },
  { id: "h11", label: "Wallet fingerprinting", fn: analyzeWalletFingerprint },
  { id: "anon", label: "Anonymity sets", fn: analyzeAnonymitySet },
  { id: "timing", label: "Timing analysis", fn: analyzeTiming },
  { id: "script", label: "Script type analysis", fn: analyzeScriptTypeMix },
  { id: "dust", label: "Dust output detection", fn: analyzeDustOutputs },
  { id: "h17", label: "Multisig/escrow detection", fn: analyzeMultisigDetection },
  { id: "peel", label: "Peel chain detection", fn: analyzePeelChain },
  { id: "consolidation", label: "Consolidation patterns", fn: analyzeConsolidation },
  { id: "unnecessary", label: "Unnecessary inputs", fn: analyzeUnnecessaryInput },
  { id: "tx0", label: "CoinJoin premix (tx0)", fn: analyzeCoinJoinPremix },
  { id: "bip69", label: "BIP69 ordering", fn: analyzeBip69 },
  { id: "bip47", label: "BIP47 notification detection", fn: analyzeBip47Notification },
  { id: "exchange", label: "Exchange pattern detection", fn: analyzeExchangePattern },
  { id: "coinsel", label: "Coin selection patterns", fn: analyzeCoinSelection },
  { id: "witness", label: "Witness data analysis", fn: analyzeWitnessData },
  { id: "postmix", label: "Post-mix consolidation", fn: analyzePostMix },
  { id: "entity", label: "Known entity detection", fn: analyzeEntityDetection },
  { id: "ricochet", label: "Ricochet detection", fn: analyzeRicochet },
] as const;

export const ADDRESS_HEURISTICS = [
  { id: "h8", label: "Address reuse", fn: analyzeAddressReuse },
  { id: "h9", label: "UTXO analysis", fn: analyzeUtxos },
  { id: "h10", label: "Address type", fn: analyzeAddressType },
  { id: "spending", label: "Spending patterns", fn: analyzeSpendingPattern },
  { id: "recurring", label: "Recurring payment detection", fn: analyzeRecurringPayment },
  { id: "highactivity", label: "High activity detection", fn: analyzeHighActivityAddress },
] as const;

const CHAIN_STEPS = [
  { id: "chain-backward", label: "Input provenance analysis" },
  { id: "chain-forward", label: "Output destination analysis" },
  { id: "chain-cluster", label: "Address clustering" },
  { id: "chain-spending", label: "Spending pattern analysis" },
  { id: "chain-entity", label: "Entity proximity scan" },
  { id: "chain-taint", label: "Taint flow analysis" },
] as const;

/** Yield to the event loop so the UI can update. */
export function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

export function getTxHeuristicSteps(t?: HeuristicTranslator): HeuristicStep[] {
  return [
    ...TX_HEURISTICS.map((h) => ({
      id: h.id,
      label: t ? t(`step.${h.id}.label`, { defaultValue: h.label }) : h.label,
      status: "pending" as const,
    })),
    ...CHAIN_STEPS.map((h) => ({
      id: h.id,
      label: t ? t(`step.${h.id}.label`, { defaultValue: h.label }) : h.label,
      status: "pending" as const,
    })),
  ];
}

export function getAddressHeuristicSteps(t?: HeuristicTranslator): HeuristicStep[] {
  return ADDRESS_HEURISTICS.map((h) => ({
    id: h.id,
    label: t ? t(`step.${h.id}.label`, { defaultValue: h.label }) : h.label,
    status: "pending" as const,
  }));
}

/**
 * Run all transaction heuristics and return scored results.
 *
 * The onStep callback is called before each heuristic runs, enabling
 * the diagnostic loader UI to show progress.
 */
export async function analyzeTransaction(
  tx: MempoolTransaction,
  rawHex?: string,
  onStep?: (stepId: string, impact?: number) => void,
  ctx?: TxContext,
): Promise<ScoringResult> {
  const allFindings: Finding[] = [];

  for (const heuristic of TX_HEURISTICS) {
    onStep?.(heuristic.id);

    // Small delay to let the UI update and create the diagnostic effect
    await tick();

    try {
      const result = heuristic.fn(tx, rawHex, ctx);
      allFindings.push(...result.findings);

      // Report cumulative impact so the UI can show a running score
      const stepImpact = sumImpact(result.findings);
      onStep?.(heuristic.id, stepImpact);
    } catch (err) {
      // A single heuristic failure should not crash the entire analysis
      console.error(`[analyzeTransaction] ${heuristic.id} failed:`, err);
      onStep?.(heuristic.id, 0);
    }
  }

  // Cross-heuristic intelligence
  applyCrossHeuristicRules(allFindings);

  const result = calculateScore(allFindings);
  result.txType = classifyTransactionType(allFindings);
  return result;
}

/**
 * Run all address heuristics and return scored results.
 */
export async function analyzeAddress(
  address: MempoolAddress,
  utxos: MempoolUtxo[],
  txs: MempoolTransaction[],
  onStep?: (stepId: string, impact?: number) => void,
): Promise<ScoringResult> {
  const allFindings: Finding[] = [];

  for (const heuristic of ADDRESS_HEURISTICS) {
    onStep?.(heuristic.id);
    await tick();

    try {
      const result = heuristic.fn(address, utxos, txs);
      allFindings.push(...result.findings);

      const stepImpact = sumImpact(result.findings);
      onStep?.(heuristic.id, stepImpact);
    } catch (err) {
      console.error(`[analyzeAddress] ${heuristic.id} failed:`, err);
      onStep?.(heuristic.id, 0);
    }
  }

  // Entity identification: check the target address against entity databases
  const entityMatch = matchEntitySync(address.address);
  if (entityMatch) {
    const entityInfo = getEntity(entityMatch.entityName);
    const isOfac = entityMatch.ofac || (entityInfo?.ofac ?? false);
    allFindings.unshift({
      id: "address-entity-identified",
      severity: isOfac ? "critical" : "medium",
      confidence: entityMatch.confidence,
      title: isOfac
        ? `OFAC sanctioned entity: ${entityMatch.entityName}`
        : `Identified entity: ${entityMatch.entityName}`,
      params: {
        entityName: entityMatch.entityName,
        category: entityInfo?.category ?? entityMatch.category,
        country: entityInfo?.country ?? "Unknown",
        status: entityInfo?.status ?? "unknown",
        ofac: isOfac ? 1 : 0,
      },
      description: isOfac
        ? `This address is associated with ${entityMatch.entityName}, an OFAC-sanctioned entity. ` +
          "Transacting with sanctioned addresses may have legal consequences depending on jurisdiction."
        : `This address is associated with ${entityMatch.entityName}` +
          ` (${entityInfo?.category ?? entityMatch.category}${(entityInfo?.country ?? "Unknown") !== "Unknown" ? ", " + entityInfo?.country : ""})` +
          ". Transactions involving known entities are traceable by chain analysis firms.",
      recommendation: isOfac
        ? "Exercise extreme caution. Consult legal counsel before transacting with this address."
        : "Be aware that this entity can link your transactions to your identity. " +
          "For privacy, use intermediate hops, CoinJoin, or Lightning Network before interacting with known entities.",
      scoreImpact: isOfac ? -20 : -3,
    });
  }

  // Temporal correlation analysis (uses tx history)
  if (txs.length >= 3) {
    const temporalFindings = analyzeTemporalCorrelation(txs);
    allFindings.push(...temporalFindings);
  }

  // Prospective analysis - fingerprint evolution (uses tx history)
  if (txs.length >= 2) {
    const { findings: prospectiveFindings } = analyzeFingerprintEvolution(
      address.address,
      txs,
    );
    allFindings.push(...prospectiveFindings);
  }

  // Warn if we couldn't fetch all transactions for this address
  const totalOnChain = address.chain_stats.tx_count + address.mempool_stats.tx_count;
  if (txs.length === 0 && totalOnChain > 0) {
    allFindings.push({
      id: "partial-history-unavailable",
      severity: "medium",
      title: "Transaction history unavailable",
      params: { totalOnChain },
      description:
        `This address has ${fmtN(totalOnChain)} transactions but transaction history could not be fetched. ` +
        "Spending pattern analysis could not be performed, so the score may be incomplete.",
      recommendation:
        "Try again later, or use a custom API endpoint with higher rate limits.",
      scoreImpact: 0,
    });
  } else if (txs.length > 0 && totalOnChain > txs.length) {
    allFindings.push({
      id: "partial-history-partial",
      severity: "low",
      title: `Partial history analyzed (${txs.length} of ${fmtN(totalOnChain)} transactions)`,
      params: { totalOnChain, txsAnalyzed: txs.length },
      description:
        `This address has ${fmtN(totalOnChain)} total transactions but only the most recent ${txs.length} were analyzed. ` +
        "Older transactions may contain additional privacy-relevant patterns not reflected in these results.",
      recommendation:
        "For a complete analysis of high-activity addresses, consider running a full node with a local Electrum server.",
      scoreImpact: 0,
    });
  }

  return calculateScore(allFindings, "address");
}
