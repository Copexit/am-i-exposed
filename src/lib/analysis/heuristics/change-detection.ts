import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import type { MempoolVin, MempoolVout } from "@/lib/api/types";
import { getAddressType } from "@/lib/bitcoin/address-type";

/**
 * H2: Change Detection
 *
 * Identifies the likely change output using multiple sub-heuristics:
 * 1. Address type mismatch: change usually matches input address type
 * 2. Round payment: the non-round output is likely change
 * 3. Script type reuse: change often matches the input script type
 * 4. Largest/smallest output heuristic
 *
 * When change is identifiable, the payment amount and direction are revealed.
 *
 * Reference: Meiklejohn et al., 2013
 * Impact: -5 to -15
 */
export const analyzeChangeDetection: TxHeuristic = (tx) => {
  const findings: Finding[] = [];

  // Filter out OP_RETURN outputs before analysis (they are data-only, not payments)
  const spendableOutputs = tx.vout.filter(
    (out) => out.scriptpubkey_type !== "op_return" && out.scriptpubkey_address,
  );

  // Only applies to transactions with exactly 2 spendable outputs
  // (more complex transactions need graph analysis)
  if (spendableOutputs.length !== 2) return { findings };

  // Skip if either output has no address
  if (!spendableOutputs[0].scriptpubkey_address || !spendableOutputs[1].scriptpubkey_address) {
    return { findings };
  }

  // Skip coinbase
  if (tx.vin.some((v) => v.is_coinbase)) return { findings };

  const signals: string[] = [];
  const changeIndices = new Map<number, number>(); // output index -> signal count

  // Sub-heuristic 1: Address type mismatch
  checkAddressTypeMismatch(tx.vin, spendableOutputs, changeIndices, signals);

  // Sub-heuristic 2: Round amount
  checkRoundAmount(spendableOutputs, changeIndices, signals);

  // Sub-heuristic 3: Script type reuse
  checkScriptTypeReuse(tx.vin, spendableOutputs, changeIndices, signals);

  if (signals.length === 0) return { findings };

  // Check if signals agree on which output is change
  const maxSignals = Math.max(
    changeIndices.get(0) ?? 0,
    changeIndices.get(1) ?? 0,
  );

  const confidence =
    signals.length >= 3
      ? "high"
      : signals.length >= 2
        ? "medium"
        : "low";

  const impact = confidence === "high" ? -15 : confidence === "medium" ? -10 : -5;

  findings.push({
    id: "h2-change-detected",
    severity:
      confidence === "high"
        ? "high"
        : confidence === "medium"
          ? "medium"
          : "low",
    title: `Change output likely identifiable (${confidence} confidence)`,
    description:
      `${signals.length} sub-heuristic${signals.length > 1 ? "s" : ""} point to a likely change output: ${signals.join("; ")}. ` +
      (maxSignals >= 2
        ? "Multiple signals agree, making change identification reliable. "
        : "") +
      "When the change output is known, the exact payment amount and recipient are revealed.",
    recommendation:
      "Use wallets with change output randomization. Avoid round payment amounts. Consider using the same address type for all outputs (Taproot makes this easier).",
    scoreImpact: impact,
    remediation: {
      steps: [
        "Avoid sending round BTC amounts (e.g., 0.01 BTC) - use exact amounts or add randomness to make both outputs look similar.",
        "Use a Taproot (bc1p) wallet so all outputs use the same script type, removing the address-type-mismatch signal.",
        "Use coin control to spend the change output in isolation, avoiding further linkage.",
        "Consider PayJoin for your next payment - it adds receiver inputs that break change analysis.",
      ],
      tools: [
        { name: "Sparrow Wallet", url: "https://sparrowwallet.com" },
        { name: "BTCPay Server (PayJoin)", url: "https://btcpayserver.org" },
      ],
      urgency: "when-convenient",
    },
  });

  return { findings };
};


function checkAddressTypeMismatch(
  vin: MempoolVin[],
  vout: MempoolVout[],
  changeIndices: Map<number, number>,
  signals: string[],
) {
  // Collect input address types
  const inputTypes = new Set<string>();
  for (const v of vin) {
    if (v.prevout?.scriptpubkey_address) {
      inputTypes.add(getAddressType(v.prevout.scriptpubkey_address));
    }
  }

  if (inputTypes.size !== 1) return; // Mixed inputs, can't determine

  const inputType = [...inputTypes][0];
  const out0Type = getAddressType(vout[0].scriptpubkey_address!);
  const out1Type = getAddressType(vout[1].scriptpubkey_address!);

  // If one output matches input type and the other doesn't
  if (out0Type === inputType && out1Type !== inputType) {
    changeIndices.set(0, (changeIndices.get(0) ?? 0) + 1);
    signals.push("change matches input address type");
  } else if (out1Type === inputType && out0Type !== inputType) {
    changeIndices.set(1, (changeIndices.get(1) ?? 0) + 1);
    signals.push("change matches input address type");
  }
}

function checkRoundAmount(
  vout: MempoolVout[],
  changeIndices: Map<number, number>,
  signals: string[],
) {
  const round0 = isRound(vout[0].value);
  const round1 = isRound(vout[1].value);

  // If exactly one output is round, the other is likely change
  if (round0 && !round1) {
    changeIndices.set(1, (changeIndices.get(1) ?? 0) + 1);
    signals.push("non-round output is likely change");
  } else if (round1 && !round0) {
    changeIndices.set(0, (changeIndices.get(0) ?? 0) + 1);
    signals.push("non-round output is likely change");
  }
}

function checkScriptTypeReuse(
  vin: MempoolVin[],
  vout: MempoolVout[],
  changeIndices: Map<number, number>,
  signals: string[],
) {
  // Collect input script types
  const inputScriptTypes = new Set<string>();
  for (const v of vin) {
    if (v.prevout?.scriptpubkey_type) {
      inputScriptTypes.add(v.prevout.scriptpubkey_type);
    }
  }

  if (inputScriptTypes.size !== 1) return;

  const inputScriptType = [...inputScriptTypes][0];

  const match0 = vout[0].scriptpubkey_type === inputScriptType;
  const match1 = vout[1].scriptpubkey_type === inputScriptType;

  if (match0 && !match1) {
    changeIndices.set(0, (changeIndices.get(0) ?? 0) + 1);
    signals.push("change reuses input script type");
  } else if (match1 && !match0) {
    changeIndices.set(1, (changeIndices.get(1) ?? 0) + 1);
    signals.push("change reuses input script type");
  }
}

function isRound(sats: number): boolean {
  if (sats % 1_000_000 === 0) return true;
  if (sats % 100_000 === 0) return true;
  if (sats % 10_000 === 0) return true;
  return false;
}
