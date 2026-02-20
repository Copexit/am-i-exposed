import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";

/**
 * Dust Output Detection (transaction level)
 *
 * Flags suspiciously tiny outputs (< 1000 sats) that may be:
 * - Surveillance dust sent to track address clusters
 * - Uneconomical outputs that cost more in fees to spend than they're worth
 *
 * Dust attacks are a common chain analysis technique where tiny amounts
 * are sent to target addresses, then the attacker monitors when the dust
 * is spent (revealing which UTXOs belong to the same wallet).
 *
 * Impact: -3 to -8
 */

const DUST_THRESHOLD = 1000; // sats
const EXTREME_DUST_THRESHOLD = 600; // below typical minimum relay fee

export const analyzeDustOutputs: TxHeuristic = (tx) => {
  const findings: Finding[] = [];

  const dustOutputs = tx.vout.filter(
    (out) =>
      out.value > 0 &&
      out.value < DUST_THRESHOLD &&
      out.scriptpubkey_type !== "op_return",
  );

  if (dustOutputs.length === 0) return { findings };

  const extremeDust = dustOutputs.filter(
    (out) => out.value < EXTREME_DUST_THRESHOLD,
  );

  const totalDustValue = dustOutputs.reduce((sum, out) => sum + out.value, 0);

  // Check if this looks like a dust attack:
  // - Classic: 1 input, 2 outputs, 1 dust (attacker sends dust + change)
  // - Batch: many outputs, majority are dust (attacker dusts many addresses at once)
  const isLikelyDustAttack =
    (dustOutputs.length === 1 && tx.vout.length === 2 && tx.vin.length === 1) ||
    (dustOutputs.length >= 5 && dustOutputs.length > tx.vout.length * 0.5);

  if (isLikelyDustAttack) {
    findings.push({
      id: "dust-attack",
      severity: "high",
      title: `Possible dust attack (${totalDustValue} sats)`,
      params: { totalDustValue },
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
    const severity = extremeDust.length > 0 ? "medium" : "low";
    findings.push({
      id: "dust-outputs",
      severity,
      title: `${dustOutputs.length} dust output${dustOutputs.length > 1 ? "s" : ""} detected (< ${DUST_THRESHOLD} sats)`,
      params: { dustCount: dustOutputs.length, threshold: DUST_THRESHOLD, totalDustValue, extremeCount: extremeDust.length },
      description:
        `This transaction contains ${dustOutputs.length} output${dustOutputs.length > 1 ? "s" : ""} ` +
        `below ${DUST_THRESHOLD} sats (total: ${totalDustValue} sats). ` +
        "Tiny outputs are uneconomical to spend and may indicate dust for tracking purposes. " +
        (extremeDust.length > 0
          ? `${extremeDust.length} output${extremeDust.length > 1 ? "s are" : " is"} below the typical minimum relay fee threshold.`
          : ""),
      recommendation:
        "Be cautious when spending dust UTXOs. Use coin control to avoid mixing them " +
        "with your main UTXOs, which could link your addresses together.",
      scoreImpact: extremeDust.length > 0 ? -5 : -3,
    });
  }

  return { findings };
};
