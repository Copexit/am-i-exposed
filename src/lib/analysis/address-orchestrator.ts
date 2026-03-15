import type { Finding, Severity, TxAnalysisResult } from "@/lib/types";
import type {
  MempoolTransaction,
  MempoolAddress,
  MempoolUtxo,
} from "@/lib/api/types";
import { calculateScore, sumImpact } from "@/lib/scoring/score";
import { checkOfac } from "./cex-risk/ofac-check";
import { applyCrossHeuristicRules } from "./cross-heuristic";
import { TX_HEURISTICS, ADDRESS_HEURISTICS, tick } from "./orchestrator";

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
      try {
        const result = heuristic.fn(tx);
        allFindings.push(...result.findings);
      } catch (err) {
        console.error(`[analyzeTransactionsForAddress] ${heuristic.id} failed:`, err);
      }
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
    try {
      const result = heuristic.fn(address, utxos, txs);
      allFindings.push(...result.findings);
      const stepImpact = sumImpact(result.findings);
      onStep?.(heuristic.id, stepImpact);
    } catch (err) {
      console.error(`[analyzeDestination] ${heuristic.id} failed:`, err);
      onStep?.(heuristic.id, 0);
    }
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
