import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import type { MempoolTransaction, MempoolVout } from "@/lib/api/types";
import { WHIRLPOOL_POOLS, type WhirlpoolPool } from "@/lib/constants";
import { fmtN, formatBtc } from "@/lib/format";
import { isCoinbase, getValuedOutputs, countOutputValues, isOpReturnOutput } from "./tx-utils";

/**
 * CoinJoin Premix (tx0) Detection
 *
 * Detects Whirlpool tx0 (premix) transactions: the precursor to a CoinJoin mix.
 * A tx0 splits a UTXO into equal-denomination outputs ready for mixing,
 * plus a coordinator fee and toxic change.
 *
 * Pattern:
 * - 1 input (sometimes 2-3 for larger premixes)
 * - Multiple outputs at a Whirlpool denomination
 * - 1 small coordinator fee output
 * - 0-1 toxic change output (remainder)
 *
 * The toxic change is NOT mixed and should never be spent alongside
 * post-mix outputs. It must be flagged explicitly.
 *
 * Impact: +5 (positive - indicates CoinJoin preparation)
 */
/**
 * Premix outputs are the pool denomination plus a miner-fee reserve for the
 * mix (e.g. 2,500,605 sats in the 0.025 BTC pool), so they rarely equal the
 * denomination exactly. Accept values up to this far above it, but only when
 * the tx also carries the tx0 OP_RETURN (fee payload) to avoid false positives.
 */
const PREMIX_FEE_TOLERANCE = 20_000;

export interface Tx0Match {
  pool: WhirlpoolPool;
  /** Actual premix output value (denomination + miner fee reserve) */
  premixValue: number;
  denomOutputs: MempoolVout[];
  feeOutput: MempoolVout;
  toxicChange?: MempoolVout;
}

/** Structural Whirlpool tx0 match, shared by the premix heuristic, CoinJoin detection and chain analysis. */
export function detectTx0(tx: MempoolTransaction): Tx0Match | null {
  // tx0 typically has 1-3 inputs
  if (tx.vin.length < 1 || tx.vin.length > 3) return null;
  if (isCoinbase(tx)) return null;

  const spendable = getValuedOutputs(tx.vout);

  // Need at least 3 outputs: 2+ denomination outputs + fee/change
  if (spendable.length < 3) return null;

  const hasOpReturn = tx.vout.some((o) => isOpReturnOutput(o));
  const valueCounts = countOutputValues(spendable);

  for (const pool of WHIRLPOOL_POOLS) {
    const denom = pool.sats;
    // Pick the equal-output group matching this pool (exact, or denom + fee reserve with OP_RETURN)
    let premixValue = 0;
    for (const [value, count] of valueCounts) {
      if (count < 2) continue;
      const inRange = value === denom || (hasOpReturn && value > denom && value <= denom + PREMIX_FEE_TOLERANCE);
      if (inRange && count > (valueCounts.get(premixValue) ?? 0)) premixValue = value;
    }
    if (premixValue === 0) continue;

    const denomOutputs = spendable.filter((o) => o.value === premixValue);
    // The non-denomination outputs should be the fee + toxic change
    const nonDenomOutputs = spendable.filter((o) => o.value !== premixValue);

    // tx0 should have 1-2 non-denomination outputs (fee + optional change)
    if (nonDenomOutputs.length < 1 || nonDenomOutputs.length > 2) continue;

    // The coordinator fee is typically small (0.5-5% of denomination)
    const feeOutput = nonDenomOutputs.reduce(
      (smallest, o) => (o.value < smallest.value ? o : smallest),
      nonDenomOutputs[0],
    );
    if (!(feeOutput.value < denom * 0.5 && feeOutput.value > 0)) continue;

    // If there's a second non-denom output, it's the toxic change
    const toxicChange = nonDenomOutputs.length === 2
      ? nonDenomOutputs.find((o) => o !== feeOutput)
      : undefined;

    return { pool, premixValue, denomOutputs, feeOutput, toxicChange };
  }

  return null;
}

export const analyzeCoinJoinPremix: TxHeuristic = (tx) => {
  const findings: Finding[] = [];
  const match = detectTx0(tx);
  if (!match) return { findings };

  const { pool, denomOutputs, feeOutput: feeCandidate, toxicChange } = match;
  const denomBtcLabel = formatBtc(pool.sats);
  const eraLabel = pool.era === "ashigaru" ? "Ashigaru" : "Samourai";

  findings.push({
    id: "tx0-premix",
    severity: "good",
    confidence: "high",
    title: `${eraLabel} CoinJoin premix (tx0): ${denomOutputs.length} outputs at ${denomBtcLabel}`,
    params: {
      denomination: denomBtcLabel.replace(/ BTC$/, ""),
      denomCount: denomOutputs.length,
      hasToxicChange: toxicChange ? 1 : 0,
      toxicChangeValue: toxicChange?.value ?? 0,
      coordinatorFee: feeCandidate.value,
      era: pool.era,
      _variant: pool.era,
      ...(toxicChange ? { context: "toxic" } : {}),
    },
    description:
      `This transaction is a ${eraLabel} Whirlpool tx0 (premix): it splits funds into ${denomOutputs.length} equal outputs ` +
      `of ${denomBtcLabel} ready for CoinJoin mixing. ` +
      (toxicChange
        ? `The toxic change output (${fmtN(toxicChange.value)} sats) is NOT mixed and must be handled carefully. `
        : "") +
      `Coordinator fee: ${fmtN(feeCandidate.value)} sats.`,
    recommendation:
      "This is the first step of a CoinJoin mix - positive for privacy. " +
      (toxicChange
        ? "CRITICAL: The toxic change output must NEVER be spent alongside your post-mix (mixed) outputs. " +
          "Freeze it in your wallet or spend it through a separate mixing cycle. " +
          "Spending toxic change with mixed UTXOs undoes all CoinJoin privacy gains."
        : "No toxic change detected - all funds are allocated to mixing denominations."),
    scoreImpact: 5,
    remediation: {
      keyPrefix: toxicChange ? "tx0-premix-toxic" : "tx0-premix-clean",
      qualifier: toxicChange
        ? `Toxic change: ${fmtN(toxicChange.value)} sats. This output is NOT mixed and must be isolated.`
        : "No toxic change output - clean premix.",
      steps: toxicChange
        ? [
            "Immediately freeze the toxic change output in your wallet's coin control.",
            "Never spend the toxic change alongside post-mix (mixed) UTXOs.",
            "Consider mixing the toxic change in a separate cycle or spending it independently.",
            "Label this UTXO as 'toxic change - do not mix' in your wallet.",
          ]
        : [
            "Proceed to mix your premix outputs through Whirlpool rounds.",
            "After mixing, maintain strict UTXO segregation between mixed and unmixed funds.",
          ],
      tools: [
        { name: "Ashigaru (Whirlpool)", url: "https://ashigaru.rs" },
        { name: "Sparrow Wallet (Coin Control)", url: "https://sparrowwallet.com" },
      ],
      urgency: toxicChange ? "immediate" as const : "when-convenient" as const,
    },
  });

  return { findings };
};
