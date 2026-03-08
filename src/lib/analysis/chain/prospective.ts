import type { MempoolTransaction } from "@/lib/api/types";
import type { Finding } from "@/lib/types";

/**
 * Prospective Analysis - Fingerprint Evolution Timeline
 *
 * Tracks how wallet fingerprint signals change over time for an address:
 * - nVersion usage changes (1 -> 2 or vice versa)
 * - nLockTime behavior changes (0 -> block height, etc.)
 * - Script type transitions (P2PKH -> P2WPKH -> P2TR)
 * - Detects wallet migrations (Electrum -> Sparrow, etc.)
 * - Flags mixed fingerprint patterns
 *
 * This is "prospective analysis" - looking at an entity's history to
 * understand their privacy trajectory and identify wallet changes.
 */

export interface FingerprintSnapshot {
  txid: string;
  blockTime: number;
  blockHeight: number;
  nVersion: number;
  nLockTime: number;
  locktimeType: "zero" | "block-exact" | "block-randomized" | "block-general" | "timestamp";
  scriptTypes: string[];
  hasRbf: boolean;
  /** Whether this tx was sent from this address (has inputs from it) */
  isSender: boolean;
}

export interface FingerprintEvolution {
  snapshots: FingerprintSnapshot[];
  findings: Finding[];
  /** Summary of detected wallet transitions */
  transitions: WalletTransition[];
}

interface WalletTransition {
  fromTxid: string;
  toTxid: string;
  fromBlockHeight: number;
  toBlockHeight: number;
  changes: string[];
}

/**
 * Analyze fingerprint evolution across an address's transaction history.
 * Only analyzes transactions where the address is a sender (has inputs).
 */
export function analyzeFingerprintEvolution(
  address: string,
  txs: MempoolTransaction[],
): FingerprintEvolution {
  const findings: Finding[] = [];

  // Filter to confirmed txs where this address is a sender (has inputs from this address)
  const senderTxs = txs.filter(
    (tx) =>
      tx.status.confirmed &&
      tx.status.block_time &&
      tx.status.block_height &&
      tx.vin.some((v) => v.prevout?.scriptpubkey_address === address),
  );

  if (senderTxs.length < 2) {
    return { snapshots: [], findings, transitions: [] };
  }

  // Sort by block time ascending
  const sorted = [...senderTxs].sort(
    (a, b) => a.status.block_time! - b.status.block_time!,
  );

  // Build fingerprint snapshots
  const snapshots: FingerprintSnapshot[] = sorted.map((tx) =>
    buildSnapshot(tx, address),
  );

  // Detect transitions between consecutive snapshots
  const transitions: WalletTransition[] = [];

  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1];
    const curr = snapshots[i];
    const changes: string[] = [];

    // nVersion change
    if (prev.nVersion !== curr.nVersion) {
      changes.push(`nVersion ${prev.nVersion} -> ${curr.nVersion}`);
    }

    // Locktime behavior change
    if (prev.locktimeType !== curr.locktimeType) {
      changes.push(
        `nLockTime behavior: ${prev.locktimeType} -> ${curr.locktimeType}`,
      );
    }

    // Script type change (check input script types for this address)
    const prevTypes = new Set(prev.scriptTypes);
    const currTypes = new Set(curr.scriptTypes);
    const newTypes = [...currTypes].filter((t) => !prevTypes.has(t));
    const droppedTypes = [...prevTypes].filter((t) => !currTypes.has(t));
    if (newTypes.length > 0 || droppedTypes.length > 0) {
      if (newTypes.length > 0 && droppedTypes.length > 0) {
        changes.push(
          `Script type: ${[...prevTypes].join("+")} -> ${[...currTypes].join("+")}`,
        );
      } else if (newTypes.length > 0) {
        changes.push(`New script type added: ${newTypes.join(", ")}`);
      }
    }

    // RBF behavior change
    if (prev.hasRbf !== curr.hasRbf) {
      changes.push(
        `RBF: ${prev.hasRbf ? "enabled" : "disabled"} -> ${curr.hasRbf ? "enabled" : "disabled"}`,
      );
    }

    if (changes.length > 0) {
      transitions.push({
        fromTxid: prev.txid,
        toTxid: curr.txid,
        fromBlockHeight: prev.blockHeight,
        toBlockHeight: curr.blockHeight,
        changes,
      });
    }
  }

  // Generate findings based on transitions
  if (transitions.length > 0) {
    // Check for significant wallet migration signals
    const hasVersionChange = transitions.some((t) =>
      t.changes.some((c) => c.startsWith("nVersion")),
    );
    const hasLocktimeChange = transitions.some((t) =>
      t.changes.some((c) => c.startsWith("nLockTime")),
    );
    const hasScriptChange = transitions.some((t) =>
      t.changes.some((c) => c.startsWith("Script type")),
    );

    // Count total unique change signals
    const totalChangeSignals =
      (hasVersionChange ? 1 : 0) +
      (hasLocktimeChange ? 1 : 0) +
      (hasScriptChange ? 1 : 0);

    if (totalChangeSignals >= 2) {
      // Strong evidence of wallet migration
      findings.push({
        id: "prospective-wallet-migration",
        severity: "high",
        confidence: "high",
        title: `Wallet migration detected (${transitions.length} fingerprint change${transitions.length > 1 ? "s" : ""})`,
        description:
          "Multiple wallet fingerprint signals changed between transactions, strongly " +
          "suggesting a wallet migration. Changes detected: " +
          transitions
            .flatMap((t) => t.changes)
            .join("; ") +
          ". " +
          "Chain analysts can use these transitions to identify when an entity " +
          "switched wallet software, which narrows the set of possible users.",
        recommendation:
          "When switching wallets, send funds through a CoinJoin first. This prevents " +
          "the old wallet's fingerprint from being linked to the new wallet's spending patterns.",
        scoreImpact: -4,
        params: {
          transitionCount: transitions.length,
          changeSignals: totalChangeSignals,
        },
      });
    } else if (transitions.length >= 2) {
      // Multiple transitions but less certainty about wallet migration
      findings.push({
        id: "prospective-mixed-fingerprints",
        severity: "medium",
        confidence: "medium",
        title: `Mixed wallet fingerprints across ${snapshots.length} transactions`,
        description:
          "Transaction fingerprints from this address are inconsistent across time. " +
          "Changes detected: " +
          transitions
            .flatMap((t) => t.changes)
            .join("; ") +
          ". " +
          "Inconsistent fingerprints may indicate wallet reconfiguration, " +
          "manual transaction construction, or multi-device usage.",
        recommendation:
          "Use a single wallet with consistent settings for all transactions from the " +
          "same address cluster. Fingerprint inconsistencies make entity linking easier.",
        scoreImpact: -2,
        params: {
          transitionCount: transitions.length,
          changeSignals: totalChangeSignals,
        },
      });
    } else if (transitions.length === 1) {
      // Single transition - informational
      findings.push({
        id: "prospective-fingerprint-change",
        severity: "low",
        confidence: "medium",
        title: "Wallet fingerprint change detected",
        description:
          "A wallet fingerprint change was detected between transactions: " +
          transitions[0].changes.join("; ") +
          ". This may indicate a wallet update, configuration change, or " +
          "wallet migration.",
        recommendation:
          "When changing wallet software or settings, be aware that the change itself " +
          "is visible to chain analysts and helps them track your activity.",
        scoreImpact: -1,
        params: {
          transitionCount: 1,
          changeSignals: totalChangeSignals,
        },
      });
    }
  }

  // Check for mixed script types across all snapshots
  const allScriptTypes = new Set(snapshots.flatMap((s) => s.scriptTypes));
  if (allScriptTypes.size >= 3) {
    findings.push({
      id: "prospective-script-diversity",
      severity: "medium",
      confidence: "high",
      title: `${allScriptTypes.size} different script types used over time`,
      description:
        `This address's transactions use ${allScriptTypes.size} different script types ` +
        `(${[...allScriptTypes].join(", ")}). Using many script types across transactions ` +
        "reveals an upgrade path and makes the entity more identifiable.",
      recommendation:
        "Standardize on a single script type (preferably P2TR/Taproot) for all spending. " +
        "Migrate old UTXOs through CoinJoin before consolidating.",
      scoreImpact: -2,
      params: { scriptTypeCount: allScriptTypes.size },
    });
  }

  return { snapshots, findings, transitions };
}

function buildSnapshot(
  tx: MempoolTransaction,
  address: string,
): FingerprintSnapshot {
  // Determine locktime type
  let locktimeType: FingerprintSnapshot["locktimeType"];
  if (tx.locktime === 0) {
    locktimeType = "zero";
  } else if (tx.locktime >= 500_000_000) {
    locktimeType = "timestamp";
  } else if (tx.status.block_height) {
    const delta = tx.status.block_height - tx.locktime;
    if (delta >= 0 && delta <= 1) {
      locktimeType = "block-exact";
    } else if (delta >= 2 && delta <= 100) {
      locktimeType = "block-randomized";
    } else {
      locktimeType = "block-general";
    }
  } else {
    locktimeType = "block-general";
  }

  // Collect script types from inputs belonging to this address
  const scriptTypes = tx.vin
    .filter((v) => v.prevout?.scriptpubkey_address === address)
    .map((v) => v.prevout!.scriptpubkey_type)
    .filter((t, i, arr) => arr.indexOf(t) === i);

  // Check RBF signaling
  const hasRbf = tx.vin.some((v) => v.sequence < 0xfffffffe);

  return {
    txid: tx.txid,
    blockTime: tx.status.block_time!,
    blockHeight: tx.status.block_height!,
    nVersion: tx.version,
    nLockTime: tx.locktime,
    locktimeType,
    scriptTypes,
    hasRbf,
    isSender: true,
  };
}
