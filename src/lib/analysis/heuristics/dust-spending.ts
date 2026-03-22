import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import { isCoinbase } from "./tx-utils";
import { getDustThreshold } from "./dust-output";

/**
 * Dust Spending Detection
 *
 * Detects when a dust input is co-spent with non-dust inputs. This is the
 * damaging counterpart to receiving dust: the moment a user includes a dust
 * UTXO as an input alongside their real UTXOs, common input ownership
 * heuristic (CIOH) links the dust probe to all other inputs, exposing the
 * victim's UTXO set to the attacker.
 *
 * Detection algorithm:
 * 1. For each input, check prevout.value against script-type dust threshold
 * 2. If any input is below threshold AND at least one other input is above
 *    threshold AND there are 2+ inputs, flag dust-spending
 *
 * Suppressed in CoinJoin context (coordinator fees can be below dust threshold).
 *
 * Impact: -12 (high severity)
 */
export const analyzeDustSpending: TxHeuristic = (tx) => {
  const findings: Finding[] = [];

  if (isCoinbase(tx)) return { findings };
  if (tx.vin.length < 2) return { findings };

  let hasDustInput = false;
  let hasNonDustInput = false;
  const dustInputIndices: number[] = [];

  for (let i = 0; i < tx.vin.length; i++) {
    const prevout = tx.vin[i].prevout;
    if (!prevout) continue;

    const threshold = getDustThreshold(prevout.scriptpubkey_type);
    if (prevout.value > 0 && prevout.value <= threshold) {
      hasDustInput = true;
      dustInputIndices.push(i);
    } else if (prevout.value > threshold) {
      hasNonDustInput = true;
    }
  }

  if (hasDustInput && hasNonDustInput) {
    const dustValues = dustInputIndices.map((i) => tx.vin[i].prevout!.value);
    const totalDust = dustValues.reduce((s, v) => s + v, 0);

    findings.push({
      id: "dust-spending",
      severity: "high",
      confidence: "deterministic",
      title: `Dust input co-spent with non-dust inputs (${dustInputIndices.length} dust input${dustInputIndices.length > 1 ? "s" : ""})`,
      params: {
        dustInputCount: dustInputIndices.length,
        totalInputs: tx.vin.length,
        dustValues: dustValues.join(","),
        totalDust,
      },
      description:
        `This transaction spends ${dustInputIndices.length} dust input${dustInputIndices.length > 1 ? "s" : ""} ` +
        `(${totalDust} sats total) alongside ${tx.vin.length - dustInputIndices.length} non-dust inputs. ` +
        "Common input ownership heuristic (CIOH) links the dust probe to all other inputs, " +
        "exposing the victim's UTXO set to the attacker who sent the dust. " +
        "This is the most damaging action after receiving surveillance dust.",
      recommendation:
        "Freeze dust UTXOs in your wallet's coin control (Sparrow, Ashigaru, Bitcoin Core). " +
        "Never spend dust alongside your real UTXOs. If already spent, consider CoinJoin to break the resulting link. " +
        "Enable 'do not spend below threshold' in wallet settings if available.",
      scoreImpact: -12,
      remediation: {
        steps: [
          "Use coin control to freeze any remaining dust UTXOs so they are never selected for spending.",
          "If the dust was already spent, the CIOH link is on-chain and permanent. CoinJoin the resulting outputs to break the trail.",
          "Enable automatic dust filtering in your wallet settings if available.",
          "Consider using a wallet with built-in dust protection (Sparrow, Ashigaru).",
        ],
        tools: [
          { name: "Sparrow Wallet", url: "https://sparrowwallet.com" },
          { name: "Ashigaru", url: "https://ashigaru.rs" },
        ],
        urgency: "immediate",
      },
    });
  }

  return { findings };
};
