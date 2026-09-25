import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import { isCoinbase } from "./tx-utils";

/**
 * Ricochet Hop 0 Detection
 *
 * Detects the first hop of a Ricochet transaction by identifying the
 * known Ashigaru fee address and expected fee amount. Ricochet adds
 * 4 extra hops between a CoinJoin and the final destination, creating
 * transactional distance that defeats shallow chain analysis.
 *
 * Pattern:
 * - 3+ outputs (fee + ricochet amount + change)
 * - One output pays exactly 100,000 sats to the Ashigaru fee address
 *
 * The PayNym variant of Ricochet is undetectable by design. If this
 * detection fires, the non-PayNym (standard) variant was used.
 *
 * Impact: +5 (good privacy practice)
 */

const ASHIGARU_FEE_ADDRESS = "bc1qsc887pxce0r3qed50e8he49a3amenemgptakg2";
const ASHIGARU_FEE_SATS = 100_000;

export const analyzeRicochet: TxHeuristic = (tx) => {
  const findings: Finding[] = [];

  if (isCoinbase(tx)) return { findings };

  // Ricochet hop 0 needs at least 3 outputs: fee + ricochet amount + change
  if (tx.vout.length < 3) return { findings };

  // Check if any output pays the known Ashigaru fee address with the exact fee
  const feeOutput = tx.vout.find(
    (o) =>
      o.scriptpubkey_address === ASHIGARU_FEE_ADDRESS &&
      o.value === ASHIGARU_FEE_SATS,
  );

  if (!feeOutput) return { findings };

  // Identify the ricochet output: the one that is NOT the fee address output
  // and NOT the smallest remaining output (change). It is typically the largest non-fee output.
  const feeOutputIndex = tx.vout.indexOf(feeOutput);
  const nonFeeOutputs = tx.vout
    .map((o, i) => ({ output: o, index: i }))
    .filter((_, i) => i !== feeOutputIndex);

  // Sort non-fee outputs by value descending; the largest is the ricochet output,
  // the rest are change. If only one non-fee output exists, it is the ricochet output.
  const sorted = [...nonFeeOutputs].sort((a, b) => b.output.value - a.output.value);
  const ricochetOutputIndex = sorted[0]?.index;

  if (ricochetOutputIndex === undefined) return { findings };

  findings.push({
    id: "ricochet-hop0",
    severity: "good",
    confidence: "deterministic",
    title: "Ricochet hop 0 detected (Ashigaru)",
    description:
      "This transaction pays the Ashigaru Ricochet fee (100,000 sats) to the known service address. " +
      "Ricochet adds 4 extra hops between a CoinJoin and the final destination, creating " +
      "transactional distance that defeats shallow chain analysis. The PayNym variant of " +
      "Ricochet is undetectable by design - if this detection fires, the non-PayNym variant was used.",
    recommendation:
      "Ricochet is a good practice when sending to exchanges or services that perform chain analysis. " +
      "For even better privacy, use the PayNym variant which eliminates the detectable fee address fingerprint.",
    scoreImpact: 5,
    params: {
      ricochetOutputIndex,
      hop0Txid: tx.txid,
    },
  });

  return { findings };
};
