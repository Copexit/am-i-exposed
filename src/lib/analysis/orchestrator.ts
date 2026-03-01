import type { Finding, TxAnalysisResult, Severity } from "@/lib/types";
import type {
  MempoolTransaction,
  MempoolAddress,
  MempoolUtxo,
} from "@/lib/api/types";
import type { HeuristicTranslator } from "./heuristics/types";
import {
  analyzeRoundAmounts,
  analyzeChangeDetection,
  analyzeCioh,
  analyzeCoinJoin,
  isCoinJoinFinding,
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
} from "./heuristics";
import { calculateScore } from "@/lib/scoring/score";
import { checkOfac } from "./cex-risk/ofac-check";
import type { ScoringResult } from "@/lib/types";

export interface HeuristicStep {
  id: string;
  label: string;
  status: "pending" | "running" | "done";
  impact?: number; // cumulative score impact after this step completes
}

// --- Transaction heuristics ---

const TX_HEURISTICS = [
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
] as const;

const ADDRESS_HEURISTICS = [
  { id: "h8", label: "Address reuse", fn: analyzeAddressReuse },
  { id: "h9", label: "UTXO analysis", fn: analyzeUtxos },
  { id: "h10", label: "Address type", fn: analyzeAddressType },
  { id: "spending", label: "Spending patterns", fn: analyzeSpendingPattern },
] as const;

export function getTxHeuristicSteps(t?: HeuristicTranslator): HeuristicStep[] {
  return TX_HEURISTICS.map((h) => ({
    id: h.id,
    label: t ? t(`step.${h.id}.label`, { defaultValue: h.label }) : h.label,
    status: "pending" as const,
  }));
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
): Promise<ScoringResult> {
  const allFindings: Finding[] = [];

  for (const heuristic of TX_HEURISTICS) {
    onStep?.(heuristic.id);

    // Small delay to let the UI update and create the diagnostic effect
    await tick();

    const result = heuristic.fn(tx, rawHex);
    allFindings.push(...result.findings);

    // Report cumulative impact so the UI can show a running score
    const stepImpact = result.findings.reduce((s, f) => s + f.scoreImpact, 0);
    onStep?.(heuristic.id, stepImpact);
  }

  // Cross-heuristic intelligence
  applyCrossHeuristicRules(allFindings);

  return calculateScore(allFindings);
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

    const result = heuristic.fn(address, utxos, txs);
    allFindings.push(...result.findings);

    const stepImpact = result.findings.reduce((s, f) => s + f.scoreImpact, 0);
    onStep?.(heuristic.id, stepImpact);
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
        `This address has ${totalOnChain.toLocaleString()} transactions but transaction history could not be fetched. ` +
        "Spending pattern analysis could not be performed, so the score may be incomplete.",
      recommendation:
        "Try again later, or use a custom API endpoint with higher rate limits.",
      scoreImpact: 0,
    });
  } else if (txs.length > 0 && totalOnChain > txs.length) {
    allFindings.push({
      id: "partial-history-partial",
      severity: "low",
      title: `Partial history analyzed (${txs.length} of ${totalOnChain.toLocaleString()} transactions)`,
      params: { totalOnChain, txsAnalyzed: txs.length },
      description:
        `This address has ${totalOnChain.toLocaleString()} total transactions but only the most recent ${txs.length} were analyzed. ` +
        "Older transactions may contain additional privacy-relevant patterns not reflected in these results.",
      recommendation:
        "For a complete analysis of high-activity addresses, consider running a full node with a local Electrum server.",
      scoreImpact: 0,
    });
  }

  return calculateScore(allFindings);
}

/**
 * Cross-heuristic intelligence: adjust findings based on interactions
 * between different heuristics. This runs after all heuristics complete.
 */
function applyCrossHeuristicRules(findings: Finding[]): void {
  const isCoinJoin = findings.some(isCoinJoinFinding);

  if (isCoinJoin) {
    for (const f of findings) {
      // CIOH is expected in CoinJoin (each input = different participant)
      if (f.id === "h3-cioh") {
        f.severity = "low";
        f.params = { ...f.params, context: "coinjoin" };
        f.scoreImpact = 0;
      }
      // Round amounts in CoinJoin are the denomination, not a privacy leak
      if (f.id === "h1-round-amount") {
        f.severity = "low";
        f.params = { ...f.params, context: "coinjoin" };
        f.scoreImpact = 0;
      }
      // Change detection in CoinJoin is less reliable
      // NOTE: h2-self-send is NOT suppressed - sending back to your own
      // input address is a privacy failure even in CoinJoin context
      if (f.id === "h2-change-detected") {
        f.severity = "low";
        f.params = { ...f.params, context: "coinjoin" };
        f.scoreImpact = 0;
      }
      // Script type mixing is expected in CoinJoin (participants use different wallets)
      if (f.id === "script-mixed") {
        f.severity = "low";
        f.params = { ...f.params, context: "coinjoin" };
        f.scoreImpact = 0;
      }
      // Wallet fingerprint is less relevant for CoinJoin - but we can infer the wallet
      // from the CoinJoin type detected by H4
      if (f.id === "h11-wallet-fingerprint") {
        f.severity = "low";
        // Infer wallet from CoinJoin type if not already identified
        if (!f.params?.walletGuess) {
          const isWabiSabi = findings.some(
            (x) => x.id === "h4-coinjoin" && x.params?.isWabiSabi === 1,
          );
          const isWhirlpool = findings.some((x) => x.id === "h4-whirlpool");
          if (isWabiSabi) {
            f.params = { ...f.params, walletGuess: "Wasabi Wallet" };
          } else if (isWhirlpool) {
            f.params = { ...f.params, walletGuess: "Samourai/Sparrow" };
          }
        }
        // Compose context: identified (if wallet known) or signals variant + coinjoin
        const hasWallet = !!f.params?.walletGuess;
        const base = hasWallet
          ? "identified"
          : ((f.params?.context as string) ?? "signals_other");
        f.params = { ...f.params, context: `${base}_coinjoin` };
        f.scoreImpact = 0;
      }
      // Dust outputs in CoinJoin may be coordinator fees (e.g. Whirlpool)
      if (f.id === "dust-attack" || f.id === "dust-outputs") {
        f.severity = "low";
        f.params = { ...f.params, context: "coinjoin" };
        f.scoreImpact = 0;
      }
      // Timing analysis is meaningless for CoinJoin (participants broadcast together)
      if (f.id === "timing-unconfirmed") {
        f.severity = "low";
        f.params = { ...f.params, context: "coinjoin" };
        f.scoreImpact = 0;
      }
      // Fee fingerprinting reveals the coordinator, not the participant's wallet
      if (f.id === "h6-round-fee-rate" || f.id === "h6-rbf-signaled") {
        f.severity = "low";
        f.params = { ...f.params, context: "coinjoin" };
        f.scoreImpact = 0;
      }
      // No anonymity set finding: CoinJoin structure itself provides privacy
      // beyond simple output value matching, so the penalty is unwarranted
      if (f.id === "anon-set-none" || f.id === "anon-set-moderate") {
        f.severity = "low";
        f.params = { ...f.params, context: "coinjoin" };
        f.scoreImpact = 0;
      }
    }
  }

}

/**
 * Run all tx-level heuristics on each of an address's transactions.
 * Returns per-tx analysis results (capped at 50 most recent).
 */
export async function analyzeTransactionsForAddress(
  targetAddress: string,
  txs: MempoolTransaction[],
): Promise<TxAnalysisResult[]> {
  const cap = Math.min(txs.length, 50);
  const results: TxAnalysisResult[] = [];

  for (let i = 0; i < cap; i++) {
    // Yield to the event loop every 10 txs to prevent UI freezing
    if (i > 0 && i % 10 === 0) await tick();

    const tx = txs[i];
    const allFindings: Finding[] = [];

    for (const heuristic of TX_HEURISTICS) {
      const result = heuristic.fn(tx);
      allFindings.push(...result.findings);
    }

    applyCrossHeuristicRules(allFindings);

    const isSender = tx.vin.some(
      (v) => v.prevout?.scriptpubkey_address === targetAddress,
    );
    const isReceiver = tx.vout.some(
      (v) => v.scriptpubkey_address === targetAddress,
    );

    const scored = calculateScore(allFindings);
    results.push({
      txid: tx.txid,
      tx,
      findings: scored.findings,
      score: scored.score,
      grade: scored.grade,
      role: isSender && isReceiver ? "both" : isSender ? "sender" : "receiver",
    });
  }

  return results;
}

// ── Pre-send destination check (H13) ────────────────────────────────────────

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface PreSendResult {
  riskLevel: RiskLevel;
  summary: string;
  summaryKey: string;
  findings: Finding[];
  txCount: number;
  timesReceived: number;
  totalReceived: number;
}

/**
 * H13: Analyze a destination address before sending.
 * Runs the same address heuristics but presents results as a risk assessment.
 */
export async function analyzeDestination(
  address: MempoolAddress,
  utxos: MempoolUtxo[],
  txs: MempoolTransaction[],
  onStep?: (stepId: string, impact?: number) => void,
): Promise<PreSendResult> {
  const allFindings: Finding[] = [];

  for (const heuristic of ADDRESS_HEURISTICS) {
    onStep?.(heuristic.id);
    await tick();
    const result = heuristic.fn(address, utxos, txs);
    allFindings.push(...result.findings);
    const stepImpact = result.findings.reduce((s, f) => s + f.scoreImpact, 0);
    onStep?.(heuristic.id, stepImpact);
  }

  const { chain_stats, mempool_stats } = address;
  // Use tx_count for display, but funded_txo_count for reuse detection.
  // An address with tx_count=2 but funded_txo_count=1 was received once and
  // spent once - normal single-use behavior, not reuse.
  const txCount = chain_stats.tx_count + mempool_stats.tx_count;
  const reuseCount = chain_stats.funded_txo_count + mempool_stats.funded_txo_count;
  const timesReceived = reuseCount;
  const totalReceived = chain_stats.funded_txo_sum + mempool_stats.funded_txo_sum;

  // Determine risk level based on how many times the address received funds.
  // Self-hosted mempool instances (e.g., Umbrel with romanz/electrs) may return
  // funded_txo_count=0 even when the address has activity. Fall back to tx_count
  // as a secondary signal to avoid false "Low Risk" assessments.
  let riskLevel: RiskLevel;
  let summary: string;
  let summaryKey: string;

  if (reuseCount >= 100) {
    riskLevel = "CRITICAL";
    summaryKey = "presend.summaryCritical";
    summary = `This address has received funds ${reuseCount} times. It is almost certainly a service or exchange deposit address - sending here will link your transaction to a known entity.`;
  } else if (reuseCount >= 10) {
    riskLevel = "HIGH";
    summaryKey = "presend.summaryHigh";
    summary = `This address has received funds ${reuseCount} times. All senders to this address are trivially linkable. Ask the recipient for a fresh address.`;
  } else if (reuseCount >= 2) {
    riskLevel = "HIGH";
    summaryKey = "presend.summaryHighReused";
    summary = `This address has received funds ${reuseCount} times (${txCount} total transactions). Do NOT send here - your payment will be linkable to all previous transactions to this address. Ask the recipient for a fresh address.`;
  } else if (reuseCount === 1) {
    riskLevel = "HIGH";
    summaryKey = "presend.summaryHighReceivedOnce";
    summary = "This address has already received funds once. Do NOT send here - it will create address reuse, linking your transaction to the previous one on-chain. Ask the recipient for a fresh address.";
  } else if (txCount > 0) {
    // funded_txo_count is 0 but tx_count > 0 - the address has transaction
    // activity that the backend didn't fully index (common on self-hosted
    // mempool with romanz/electrs). Any activity means the address has been
    // used. The presend is a reuse verifier - if it's used, don't send.
    riskLevel = "HIGH";
    summaryKey = "presend.summaryHighDataUnavailable";
    summary = `This address has ${txCount} transaction(s) on-chain. Even without detailed receive data, this address has been used before. Do NOT send to this address - ask the recipient for a fresh, unused address.`;
  } else {
    riskLevel = "LOW";
    summaryKey = "presend.summaryLow";
    summary = "This address appears unused. No significant privacy concerns detected for the recipient.";
  }

  // Escalate risk level if heuristic findings show high/critical severity
  const hasHighSeverityFinding = allFindings.some(
    (f) => (f.severity === "high" || f.severity === "critical") && f.scoreImpact < 0,
  );
  if (hasHighSeverityFinding && riskLevel === "LOW") {
    riskLevel = "MEDIUM";
    summary += " However, heuristic analysis identified concerning patterns.";
    summaryKey = "presend.summaryEscalated";
  }

  // Run local OFAC sanctions check (no network requests - bundled list)
  const ofacResult = checkOfac([address.address]);
  if (ofacResult.sanctioned) {
    riskLevel = "CRITICAL";
    summary = "This address appears on the OFAC sanctions list. Sending funds to this address may violate sanctions law.";
    allFindings.unshift({
      id: "h13-ofac-match",
      severity: "critical",
      title: "OFAC sanctioned address",
      description:
        "This address matches an entry on the U.S. Treasury OFAC Specially Designated Nationals (SDN) list. " +
        "Transacting with sanctioned addresses may have serious legal consequences.",
      recommendation:
        "Do NOT send funds to this address. Consult legal counsel if you have already transacted with this address.",
      scoreImpact: -100,
    });
  }

  // Add a pre-send specific finding summarizing the check
  const preSendSeverity: Severity =
    riskLevel === "CRITICAL" ? "critical" :
    riskLevel === "HIGH" ? "high" :
    riskLevel === "MEDIUM" ? "medium" : "good";

  allFindings.unshift({
    id: "h13-presend-check",
    severity: preSendSeverity,
    title: `Destination risk: ${riskLevel}`,
    params: { reuseCount, txCount, riskLevel },
    description: "Destination address was checked for reuse, sanctions, and other privacy risks.",
    recommendation:
      riskLevel === "LOW"
        ? "This destination looks clean. You can proceed with your transaction."
        : "Ask the recipient for a fresh, unused address. If this is an exchange, consider the privacy implications.",
    scoreImpact: 0,
  });

  return {
    riskLevel,
    summary,
    summaryKey,
    findings: allFindings,
    txCount,
    timesReceived,
    totalReceived,
  };
}

/** Yield to the event loop so the UI can update. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}
