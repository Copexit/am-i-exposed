import type { AddressHeuristic } from "./types";
import type { Finding } from "@/lib/types";

const DUST_THRESHOLD = 1000; // sats

/**
 * H9: UTXO Set Analysis + H12: Dust Detection
 *
 * Analyzes the UTXO set for privacy-relevant patterns:
 * - Large UTXO counts increase exposure when spent together (CIOH)
 * - Dust UTXOs (<1000 sats) may be surveillance dust attacks
 *
 * Impact: -3 to -10
 */
export const analyzeUtxos: AddressHeuristic = (_address, utxos) => {
  const findings: Finding[] = [];

  if (utxos.length === 0) {
    return { findings };
  }

  // --- Dust detection ---
  const dustUtxos = utxos.filter((u) => u.value < DUST_THRESHOLD);

  if (dustUtxos.length > 0) {
    const totalDust = dustUtxos.reduce((sum, u) => sum + u.value, 0);
    findings.push({
      id: "h9-dust-detected",
      severity: dustUtxos.length >= 3 ? "high" : "medium",
      title: `${dustUtxos.length} potential dust UTXO${dustUtxos.length > 1 ? "s" : ""} detected`,
      params: { dustCount: dustUtxos.length, totalDust, threshold: DUST_THRESHOLD },
      description:
        `Found ${dustUtxos.length} UTXO${dustUtxos.length > 1 ? "s" : ""} below ${DUST_THRESHOLD} sats (total: ${totalDust} sats). ` +
        `Tiny unsolicited UTXOs are often "dusting attacks" - surveillance entities send small amounts to track your spending. ` +
        `When you spend dust alongside other UTXOs, it links those UTXOs together via the common-input-ownership heuristic.`,
      recommendation:
        "Do NOT spend these dust UTXOs. Freeze them in your wallet's coin control feature. If your wallet does not support coin control, consider switching to one that does (Sparrow, Bitcoin Core).",
      scoreImpact: dustUtxos.length >= 3 ? -8 : -5,
    });
  }

  // --- UTXO count analysis ---
  if (utxos.length >= 20) {
    findings.push({
      id: "h9-many-utxos",
      severity: "medium",
      title: `Large UTXO set (${utxos.length} UTXOs)`,
      params: { utxoCount: utxos.length },
      description:
        `This address holds ${utxos.length} UTXOs. Spending multiple UTXOs in a single transaction links them together via CIOH, reducing privacy. Large UTXO sets also increase transaction fees.`,
      recommendation:
        "Use coin control to select specific UTXOs when spending. When possible, spend exact amounts to avoid change. " +
        "Consider consolidating during low-fee periods. For stronger privacy, run UTXOs through a CoinJoin before consolidation - but note that some exchanges may flag CoinJoin deposits.",
      scoreImpact: -3,
    });
  } else if (utxos.length >= 5) {
    findings.push({
      id: "h9-moderate-utxos",
      severity: "low",
      title: `${utxos.length} UTXOs on this address`,
      params: { utxoCount: utxos.length },
      description:
        `This address has ${utxos.length} UTXOs. Be mindful when spending - combining UTXOs in a single transaction reveals common ownership.`,
      recommendation:
        "Use coin control to select specific UTXOs when sending. Avoid auto-selection that combines all UTXOs.",
      scoreImpact: -2,
    });
  }

  if (findings.length === 0) {
    findings.push({
      id: "h9-clean",
      severity: "good",
      title: "Clean UTXO set",
      description:
        "No dust UTXOs detected and the UTXO count is manageable. This is a healthy state for privacy.",
      recommendation: "Continue practicing good UTXO management.",
      scoreImpact: 2,
    });
  }

  return { findings };
};
