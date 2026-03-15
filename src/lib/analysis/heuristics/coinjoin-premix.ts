import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import { WHIRLPOOL_DENOMS } from "@/lib/constants";
import { fmtN, formatBtc } from "@/lib/format";
import { isCoinbase } from "./tx-utils";

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
export const analyzeCoinJoinPremix: TxHeuristic = (tx) => {
  const findings: Finding[] = [];

  // tx0 typically has 1-3 inputs
  if (tx.vin.length < 1 || tx.vin.length > 3) return { findings };
  if (isCoinbase(tx)) return { findings };

  const spendable = tx.vout.filter(
    (o) => o.scriptpubkey_type !== "op_return" && o.value > 0,
  );

  // Need at least 3 outputs: 2+ denomination outputs + fee/change
  if (spendable.length < 3) return { findings };

  // Check each Whirlpool denomination
  for (const denom of WHIRLPOOL_DENOMS) {
    const denomOutputs = spendable.filter((o) => o.value === denom);

    // Need at least 2 outputs at this denomination
    if (denomOutputs.length < 2) continue;

    // The non-denomination outputs should be the fee + toxic change
    const nonDenomOutputs = spendable.filter((o) => o.value !== denom);

    // tx0 should have 1-2 non-denomination outputs (fee + optional change)
    if (nonDenomOutputs.length < 1 || nonDenomOutputs.length > 2) continue;

    // The coordinator fee is typically small (0.5-5% of denomination)
    const feeCandidate = nonDenomOutputs.reduce(
      (smallest, o) => (o.value < smallest.value ? o : smallest),
      nonDenomOutputs[0],
    );
    const isFeeReasonable = feeCandidate.value < denom * 0.5 && feeCandidate.value > 0;
    if (!isFeeReasonable) continue;

    // If there's a second non-denom output, it's the toxic change
    const toxicChange = nonDenomOutputs.length === 2
      ? nonDenomOutputs.find((o) => o !== feeCandidate)
      : undefined;

    const denomBtcLabel = formatBtc(denom);

    findings.push({
      id: "tx0-premix",
      severity: "good",
      confidence: "high",
      title: `CoinJoin premix (tx0): ${denomOutputs.length} outputs at ${denomBtcLabel}`,
      params: {
        denomination: denomBtcLabel.replace(/ BTC$/, ""),
        denomCount: denomOutputs.length,
        hasToxicChange: toxicChange ? 1 : 0,
        toxicChangeValue: toxicChange?.value ?? 0,
        coordinatorFee: feeCandidate.value,
      },
      description:
        `This transaction is a Whirlpool tx0 (premix): it splits funds into ${denomOutputs.length} equal outputs ` +
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
  }

  return { findings };
};
