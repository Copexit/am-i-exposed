/**
 * UTXO Age Spread Detection
 *
 * Flags transactions where co-spent UTXOs have vastly different creation
 * block heights. Spending a 5-year-old UTXO alongside a recent one tells
 * chain analysts the wallet has been active for years and reveals dormancy
 * windows that can be correlated with other behavioral data.
 *
 * Thresholds:
 * - > 52,560 blocks (~1 year): LOW severity, -2 impact
 * - > 210,000 blocks (~4 years): MEDIUM severity, -4 impact
 */
import type { MempoolTransaction } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import type { TxContext } from "./types";
import { fmtN } from "@/lib/format";

const BLOCKS_PER_YEAR = 52_560;  // ~365.25 * 144
const ONE_YEAR = BLOCKS_PER_YEAR;
const FOUR_YEARS = BLOCKS_PER_YEAR * 4;

export function analyzeUtxoAgeSpread(
  tx: MempoolTransaction,
  _rawHex?: string,
  ctx?: TxContext,
): { findings: Finding[] } {
  const findings: Finding[] = [];

  // Need at least 2 inputs and the transaction must be confirmed
  if (tx.vin.length < 2 || !tx.status.confirmed || !tx.status.block_height) {
    return { findings };
  }

  // Skip coinbase transactions
  if (tx.vin[0]?.is_coinbase) return { findings };

  // Collect confirmation heights of input funding transactions
  const inputHeights: number[] = [];

  for (const vin of tx.vin) {
    // Try to get the parent tx from context
    const parentTx = ctx?.parentTxs?.get(vin.txid);
    if (parentTx?.status.confirmed && parentTx.status.block_height) {
      inputHeights.push(parentTx.status.block_height);
    }
  }

  // Need heights for at least 2 inputs to compute spread
  if (inputHeights.length < 2) return { findings };

  const minHeight = Math.min(...inputHeights);
  const maxHeight = Math.max(...inputHeights);
  const spread = maxHeight - minHeight;

  if (spread < ONE_YEAR) return { findings };

  const years = Math.round((spread / BLOCKS_PER_YEAR) * 10) / 10;
  const isSevere = spread >= FOUR_YEARS;

  findings.push({
    id: "utxo-age-spread",
    severity: isSevere ? "medium" : "low",
    confidence: "deterministic",
    title: `Co-spent UTXOs span ~${years} years`,
    description:
      `The oldest input was confirmed at block ${fmtN(minHeight)} and the newest at block ${fmtN(maxHeight)}, ` +
      `a spread of ${fmtN(spread)} blocks (~${years} years). ` +
      "Spending UTXOs with vastly different ages reveals the wallet's activity window " +
      "and dormancy patterns to chain analysts, even without direct address linkage.",
    recommendation:
      "When possible, spend UTXOs of similar age together. " +
      "Use coin control to group UTXOs by creation date. " +
      "Consider CoinJoin before spending long-dormant UTXOs alongside recent ones.",
    scoreImpact: isSevere ? -4 : -2,
    params: {
      spread,
      years,
      minHeight,
      maxHeight,
      inputsWithHeight: inputHeights.length,
    },
    adversaryTiers: ["passive_observer", "kyc_exchange"],
    temporality: "historical",
  });

  return { findings };
}
