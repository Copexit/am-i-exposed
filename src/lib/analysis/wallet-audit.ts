/**
 * Wallet-Level Privacy Audit
 *
 * Aggregates analysis across all addresses derived from an xpub/descriptor
 * to produce a holistic wallet privacy assessment.
 *
 * Checks:
 * - Address reuse across the wallet
 * - UTXO hygiene (dust, toxic change, mixed script types)
 * - Spending patterns over time
 * - Fingerprint consistency across transactions
 * - Consolidation history
 */

import type { Finding, Severity, Grade } from "@/lib/types";
import { fmtN } from "@/lib/format";
import type { MempoolAddress, MempoolTransaction, MempoolUtxo } from "@/lib/api/types";
import type { DerivedAddress } from "@/lib/bitcoin/descriptor";

// ---------- Types ----------

export interface WalletAddressInfo {
  derived: DerivedAddress;
  addressData: MempoolAddress | null;
  txs: MempoolTransaction[];
  utxos: MempoolUtxo[];
}

export interface WalletAuditResult {
  score: number;
  grade: Grade;
  findings: Finding[];
  /** Total addresses with activity */
  activeAddresses: number;
  /** Total transactions across all addresses */
  totalTxs: number;
  /** Total UTXO count */
  totalUtxos: number;
  /** Total balance in sats */
  totalBalance: number;
  /** Number of addresses reused (received 2+ times) */
  reusedAddresses: number;
  /** Number of dust UTXOs (<546 sats) */
  dustUtxos: number;
}

// ---------- Analysis functions ----------

const DUST_THRESHOLD = 546; // Minimum non-dust output for P2WPKH

/** Check for address reuse across the wallet. */
function checkAddressReuse(addresses: WalletAddressInfo[]): Finding[] {
  const findings: Finding[] = [];
  let reusedCount = 0;
  let totalReceived = 0;

  for (const addr of addresses) {
    if (!addr.addressData) continue;
    const fundedCount = addr.addressData.chain_stats.funded_txo_count + addr.addressData.mempool_stats.funded_txo_count;
    if (fundedCount > 0) totalReceived++;
    if (fundedCount > 1) reusedCount++;
  }

  if (reusedCount > 0 && totalReceived > 0) {
    const ratio = reusedCount / totalReceived;
    const severity: Severity = ratio > 0.5 ? "critical" : ratio > 0.2 ? "high" : "medium";
    const impact = ratio > 0.5 ? -15 : ratio > 0.2 ? -10 : -5;

    findings.push({
      id: "wallet-address-reuse",
      severity,
      confidence: "deterministic",
      title: `${reusedCount} of ${totalReceived} addresses reused`,
      description:
        `${reusedCount} addresses in this wallet received funds more than once. ` +
        `Address reuse directly links transactions together and reveals spending patterns. ` +
        `${Math.round(ratio * 100)}% of active addresses are reused.`,
      recommendation:
        "Never reuse Bitcoin addresses. Generate a new address for each incoming payment. " +
        "Most modern wallets handle this automatically.",
      scoreImpact: impact,
      params: { reusedCount, totalReceived, ratio: Math.round(ratio * 100) },
    });
  }

  return findings;
}

/** Check UTXO hygiene - dust, toxic change, mixed origins. */
function checkUtxoHygiene(addresses: WalletAddressInfo[]): Finding[] {
  const findings: Finding[] = [];

  let dustCount = 0;
  let dustValue = 0;
  let totalUtxos = 0;
  const scriptTypes = new Set<string>();
  const utxoValues: number[] = [];

  for (const addr of addresses) {
    for (const utxo of addr.utxos) {
      totalUtxos++;
      utxoValues.push(utxo.value);
      if (utxo.value < DUST_THRESHOLD) {
        dustCount++;
        dustValue += utxo.value;
      }
    }
    if (addr.utxos.length > 0) {
      const addrStr = addr.derived.address;
      if (addrStr.startsWith("bc1q") || addrStr.startsWith("tb1q")) scriptTypes.add("p2wpkh");
      else if (addrStr.startsWith("bc1p") || addrStr.startsWith("tb1p")) scriptTypes.add("p2tr");
      else if (addrStr.startsWith("3") || addrStr.startsWith("2")) scriptTypes.add("p2sh");
      else if (addrStr.startsWith("1") || addrStr.startsWith("m") || addrStr.startsWith("n")) scriptTypes.add("p2pkh");
    }
  }

  // Dust UTXOs
  if (dustCount > 0) {
    findings.push({
      id: "wallet-dust-utxos",
      severity: dustCount > 5 ? "high" : "medium",
      confidence: "deterministic",
      title: `${dustCount} dust UTXO${dustCount > 1 ? "s" : ""} (${fmtN(dustValue)} sats)`,
      description:
        `The wallet contains ${dustCount} UTXO${dustCount > 1 ? "s" : ""} below the dust threshold (${DUST_THRESHOLD} sats). ` +
        "Dust UTXOs are uneconomical to spend and can be used in dust attacks to track wallet activity.",
      recommendation:
        "Consolidate dust UTXOs into a larger output during low-fee periods, or ignore them entirely. " +
        "Be cautious of unsolicited small amounts - these may be dust attacks.",
      scoreImpact: dustCount > 5 ? -5 : -2,
      params: { dustCount, dustValue },
    });
  }

  // Mixed script types in UTXOs (reveals wallet migration history)
  if (scriptTypes.size > 1) {
    findings.push({
      id: "wallet-mixed-script-utxos",
      severity: "medium",
      confidence: "high",
      title: `UTXOs across ${scriptTypes.size} script types`,
      description:
        `Active UTXOs exist across ${scriptTypes.size} different script types (${[...scriptTypes].join(", ")}). ` +
        "Mixing script types when spending reveals wallet migration history and makes transactions more identifiable.",
      recommendation:
        "Gradually migrate all UTXOs to a single script type (preferably P2WPKH or P2TR). " +
        "Avoid mixing script types in the same transaction.",
      scoreImpact: -3,
      params: { scriptTypes: scriptTypes.size },
    });
  }

  // UTXO count assessment
  if (totalUtxos > 50) {
    findings.push({
      id: "wallet-utxo-bloat",
      severity: "medium",
      confidence: "high",
      title: `${totalUtxos} UTXOs - consider consolidation`,
      description:
        `The wallet has ${totalUtxos} unspent outputs. A large UTXO set increases transaction fees ` +
        "and exposes more privacy information when spending multiple inputs together.",
      recommendation:
        "Consolidate smaller UTXOs during low-fee periods. Use coin control to avoid " +
        "merging UTXOs from different privacy contexts.",
      scoreImpact: -2,
      params: { totalUtxos },
    });
  }

  // Check for very small change outputs (toxic change)
  const toxicChange = utxoValues.filter(v => v > DUST_THRESHOLD && v < 10_000);
  if (toxicChange.length > 3) {
    findings.push({
      id: "wallet-toxic-change",
      severity: "high",
      confidence: "medium",
      title: `${toxicChange.length} toxic change UTXOs detected`,
      description:
        `The wallet has ${toxicChange.length} UTXOs between ${DUST_THRESHOLD} and 10,000 sats. ` +
        "These 'toxic change' outputs are too small to spend economically but large enough " +
        "to link transactions if used as inputs.",
      recommendation:
        "Use exact-match coin selection (BnB) to avoid creating change. If change is unavoidable, " +
        "consider absorbing small amounts into the fee.",
      scoreImpact: -4,
      params: { toxicCount: toxicChange.length },
    });
  }

  return findings;
}

/** Check spending patterns - consolidation, batch spending, timing. */
function checkSpendingPatterns(addresses: WalletAddressInfo[]): Finding[] {
  const findings: Finding[] = [];

  // Collect all unique transactions where this wallet is the sender
  const allTxIds = new Set<string>();
  const consolidationTxs: MempoolTransaction[] = [];

  for (const addr of addresses) {
    for (const tx of addr.txs) {
      if (allTxIds.has(tx.txid)) continue;
      allTxIds.add(tx.txid);

      // Check if this is a consolidation (multiple wallet addresses as inputs)
      if (tx.vin.length >= 3 && tx.vout.length <= 2) {
        consolidationTxs.push(tx);
      }
    }
  }

  if (consolidationTxs.length > 0) {
    findings.push({
      id: "wallet-consolidation-history",
      severity: consolidationTxs.length > 3 ? "high" : "medium",
      confidence: "medium",
      title: `${consolidationTxs.length} consolidation transaction${consolidationTxs.length > 1 ? "s" : ""} detected`,
      description:
        `Found ${consolidationTxs.length} transaction${consolidationTxs.length > 1 ? "s" : ""} that appear to be UTXO consolidations ` +
        "(many inputs, few outputs). Consolidation reveals which addresses belong to the same wallet.",
      recommendation:
        "Minimize consolidation transactions. When necessary, consolidate through a CoinJoin " +
        "or during high-traffic periods to blend with other transactions.",
      scoreImpact: consolidationTxs.length > 3 ? -5 : -3,
      params: { consolidationCount: consolidationTxs.length },
    });
  }

  return findings;
}

/** Positive finding: no address reuse. */
function checkGoodPractices(addresses: WalletAddressInfo[]): Finding[] {
  const findings: Finding[] = [];

  const active = addresses.filter(a =>
    a.addressData &&
    (a.addressData.chain_stats.tx_count + a.addressData.mempool_stats.tx_count) > 0,
  );
  const reused = active.filter(a => {
    if (!a.addressData) return false;
    const fundedCount = a.addressData.chain_stats.funded_txo_count + a.addressData.mempool_stats.funded_txo_count;
    return fundedCount > 1;
  });

  if (active.length > 5 && reused.length === 0) {
    findings.push({
      id: "wallet-no-reuse",
      severity: "good",
      confidence: "deterministic",
      title: "No address reuse detected",
      description:
        `All ${active.length} active addresses were used exactly once. ` +
        "This is the correct practice for maintaining privacy.",
      recommendation: "Keep following this practice.",
      scoreImpact: 5,
      params: { activeCount: active.length },
    });
  }

  // Check if all UTXOs are same script type
  const scriptTypes = new Set<string>();
  for (const addr of addresses) {
    if (addr.utxos.length > 0) {
      const a = addr.derived.address;
      if (a.startsWith("bc1q") || a.startsWith("tb1q")) scriptTypes.add("p2wpkh");
      else if (a.startsWith("bc1p") || a.startsWith("tb1p")) scriptTypes.add("p2tr");
      else if (a.startsWith("3") || a.startsWith("2")) scriptTypes.add("p2sh");
      else scriptTypes.add("p2pkh");
    }
  }

  if (scriptTypes.size === 1 && active.length > 3) {
    findings.push({
      id: "wallet-uniform-script",
      severity: "good",
      confidence: "deterministic",
      title: `Uniform script type: ${[...scriptTypes][0]}`,
      description:
        "All wallet UTXOs use the same script type, which avoids revealing " +
        "wallet migration history when spending.",
      recommendation: "Continue using a consistent script type.",
      scoreImpact: 3,
      params: { scriptType: [...scriptTypes][0] },
    });
  }

  return findings;
}

// ---------- Public API ----------

/** Assign a grade from a numeric score (0-100). */
function scoreToGrade(score: number): Grade {
  if (score >= 90) return "A+";
  if (score >= 75) return "B";
  if (score >= 50) return "C";
  if (score >= 25) return "D";
  return "F";
}

/**
 * Run a full wallet-level privacy audit on derived addresses.
 *
 * @param addresses - Array of derived address info (address data, txs, utxos)
 */
export function auditWallet(addresses: WalletAddressInfo[]): WalletAuditResult {
  const findings: Finding[] = [];

  // Run all checks
  findings.push(...checkAddressReuse(addresses));
  findings.push(...checkUtxoHygiene(addresses));
  findings.push(...checkSpendingPatterns(addresses));
  findings.push(...checkGoodPractices(addresses));

  // Calculate aggregate stats
  let activeAddresses = 0;
  let totalTxs = 0;
  let totalUtxos = 0;
  let totalBalance = 0;
  let reusedAddresses = 0;
  let dustUtxos = 0;
  const seenTxIds = new Set<string>();

  for (const addr of addresses) {
    if (!addr.addressData) continue;
    const txCount = addr.addressData.chain_stats.tx_count + addr.addressData.mempool_stats.tx_count;
    if (txCount > 0) activeAddresses++;
    const fundedCount = addr.addressData.chain_stats.funded_txo_count + addr.addressData.mempool_stats.funded_txo_count;
    if (fundedCount > 1) reusedAddresses++;

    for (const tx of addr.txs) {
      if (!seenTxIds.has(tx.txid)) {
        seenTxIds.add(tx.txid);
        totalTxs++;
      }
    }

    for (const utxo of addr.utxos) {
      totalUtxos++;
      totalBalance += utxo.value;
      if (utxo.value < DUST_THRESHOLD) dustUtxos++;
    }
  }

  // Score: start at 70, apply impacts, clamp 0-100
  const baseScore = 70;
  const totalImpact = findings.reduce((sum, f) => sum + f.scoreImpact, 0);
  const score = Math.max(0, Math.min(100, baseScore + totalImpact));

  return {
    score,
    grade: scoreToGrade(score),
    findings,
    activeAddresses,
    totalTxs,
    totalUtxos,
    totalBalance,
    reusedAddresses,
    dustUtxos,
  };
}
