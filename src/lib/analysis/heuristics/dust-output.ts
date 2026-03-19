import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import { DUST_THRESHOLD } from "@/lib/constants";
import { isCoinbase } from "./tx-utils";

/**
 * Dust Output Detection (transaction level)
 *
 * Flags suspiciously tiny outputs (< 1000 sats) that may be:
 * - Surveillance dust sent to track address clusters
 * - Uneconomical outputs that cost more in fees to spend than they're worth
 * - Wallet deficiency (can't calculate change properly)
 *
 * Uses script-type-aware Bitcoin Core dust thresholds:
 * - P2PKH / P2SH: 546 sats
 * - P2WPKH: 294 sats
 * - P2WSH / P2TR: 330 sats
 *
 * Impact: -3 to -8
 */

/** Outputs below this value are treated as extreme dust regardless of script type. */
const EXTREME_DUST_SATS = 600;

/** Bitcoin Core dust threshold by output script type (at 3 sat/vbyte relay fee). */
export function getDustThreshold(scriptType: string): number {
  switch (scriptType) {
    case "p2pkh":
    case "p2sh":
      return 546;
    case "v0_p2wpkh":
      return 294;
    case "v0_p2wsh":
    case "v1_p2tr":
      return 330;
    default:
      return 546; // conservative default
  }
}

export const analyzeDustOutputs: TxHeuristic = (tx) => {
  const findings: Finding[] = [];

  // Coinbase transactions can have small outputs (fees); not a dust attack
  if (isCoinbase(tx)) return { findings };

  // Collect dust outputs with their vout indices, using per-script-type thresholds
  const dustEntries: { index: number; value: number; belowEconThreshold: boolean }[] = [];
  for (let i = 0; i < tx.vout.length; i++) {
    const out = tx.vout[i];
    if (out.value > 0 && out.value < DUST_THRESHOLD && out.scriptpubkey_type !== "op_return") {
      const econThreshold = getDustThreshold(out.scriptpubkey_type);
      dustEntries.push({ index: i, value: out.value, belowEconThreshold: out.value < econThreshold });
    }
  }

  if (dustEntries.length === 0) return { findings };

  const econDustCount = dustEntries.filter((d) => d.belowEconThreshold).length;
  const totalDustValue = dustEntries.reduce((sum, d) => sum + d.value, 0);
  const dustIndicesStr = dustEntries.map((d) => d.index).join(",");

  // Check if this looks like a dust attack:
  // - Classic: 1 input, 2 outputs, 1 dust (attacker sends dust + change)
  // - Batch: many outputs, majority are dust (attacker dusts many addresses at once)
  const isLikelyDustAttack =
    (dustEntries.length === 1 && tx.vout.length === 2 && tx.vin.length === 1) ||
    (dustEntries.length >= 5 && dustEntries.length > tx.vout.length * 0.5);

  if (isLikelyDustAttack) {
    findings.push({
      id: "dust-attack",
      severity: "high",
      confidence: "medium",
      title: `Possible dust attack (${totalDustValue} sats)`,
      params: { totalDustValue, dustIndices: dustIndicesStr },
      description:
        `This transaction sends a tiny amount (${totalDustValue} sats) which is a common ` +
        "pattern in dust attacks. Attackers send small amounts to target addresses to track " +
        "when the dust is spent, revealing wallet clusters. If you received this dust, " +
        "do NOT spend it with your other UTXOs.",
      recommendation:
        "Mark this UTXO as 'do not spend' in your wallet. If you must consolidate, " +
        "use a CoinJoin or send it to a completely separate wallet first. Many wallets " +
        "support coin control to freeze individual UTXOs.",
      scoreImpact: -8,
      remediation: {
        steps: [
          "Open your wallet's coin control / UTXO management and freeze (mark as 'do not spend') this dust UTXO.",
          "Never include this UTXO in any transaction - spending it alongside your other UTXOs links all your addresses.",
          "If you must clean it up, send it through a CoinJoin or to a completely separate wallet you don't mind burning.",
        ],
        tools: [
          { name: "Sparrow Wallet (Coin Control)", url: "https://sparrowwallet.com" },
        ],
        urgency: "immediate",
      },
    });
  } else {
    // Severity: medium if any output is below its script-type Bitcoin Core dust threshold,
    // or below the extreme dust threshold. Low otherwise.
    const severity = econDustCount > 0 || dustEntries.some((d) => d.value < EXTREME_DUST_SATS) ? "medium" : "low";
    const walletDeficiency = econDustCount > 0
      ? ` ${econDustCount} output${econDustCount > 1 ? "s are" : " is"} below the Bitcoin Core dust threshold for ${econDustCount > 1 ? "their" : "its"} script type, indicating a wallet that cannot calculate change properly or a fee miscalculation.`
      : "";
    findings.push({
      id: "dust-outputs",
      severity,
      confidence: "high",
      title: `${dustEntries.length} dust output${dustEntries.length > 1 ? "s" : ""} detected (< ${DUST_THRESHOLD} sats)`,
      params: { dustCount: dustEntries.length, threshold: DUST_THRESHOLD, totalDustValue, econDustCount, dustIndices: dustIndicesStr },
      description:
        `This transaction contains ${dustEntries.length} output${dustEntries.length > 1 ? "s" : ""} ` +
        `below ${DUST_THRESHOLD} sats (total: ${totalDustValue} sats). ` +
        "Tiny outputs are uneconomical to spend and may indicate dust for tracking purposes or a wallet deficiency." +
        walletDeficiency,
      recommendation:
        "Be cautious when spending dust UTXOs. Use coin control to avoid mixing them " +
        "with your main UTXOs, which could link your addresses together.",
      scoreImpact: econDustCount > 0 || dustEntries.some((d) => d.value < EXTREME_DUST_SATS) ? -5 : -3,
    });
  }

  return { findings };
};
