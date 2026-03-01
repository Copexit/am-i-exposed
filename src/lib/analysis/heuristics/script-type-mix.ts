import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";

/**
 * Script Type Mix Analysis
 *
 * When a transaction mixes different script types (e.g., P2WPKH inputs
 * with a P2TR change output), it makes change detection easier because
 * the change output often matches the input type.
 *
 * Conversely, when all inputs and outputs use the same script type,
 * change detection is harder.
 *
 * Impact: -8 to +2
 */
export const analyzeScriptTypeMix: TxHeuristic = (tx) => {
  const findings: Finding[] = [];

  // Skip coinbase transactions (no meaningful input scripts)
  if (tx.vin.some((v) => v.is_coinbase)) return { findings };

  // Check for bare multisig outputs (P2MS) - a serious privacy concern
  const multisigOutputs = tx.vout.filter(
    (out) => out.scriptpubkey_type === "multisig",
  );
  if (multisigOutputs.length > 0) {
    findings.push({
      id: "script-multisig",
      severity: "high",
      title: `Bare multisig output${multisigOutputs.length > 1 ? "s" : ""} detected`,
      params: { count: multisigOutputs.length },
      description:
        `This transaction contains ${multisigOutputs.length} bare multisig (P2MS) output${multisigOutputs.length > 1 ? "s" : ""}. ` +
        "Bare multisig exposes ALL public keys directly on the blockchain, making it trivial to " +
        "identify the signing parties. This is a legacy pattern that should be avoided.",
      recommendation:
        "Use P2SH-wrapped or P2WSH-wrapped multisig instead of bare multisig. " +
        "Better yet, use Taproot (P2TR) with MuSig2 or FROST for multisig that looks identical to single-sig on-chain.",
      scoreImpact: -8,
    });
  }

  if (tx.vout.length < 2) return { findings };

  const inputTypes = new Set<string>();
  for (const vin of tx.vin) {
    if (vin.prevout?.scriptpubkey_type) {
      inputTypes.add(vin.prevout.scriptpubkey_type);
    }
  }

  const outputTypes = new Set<string>();
  for (const vout of tx.vout) {
    if (vout.scriptpubkey_type && vout.scriptpubkey_type !== "op_return") {
      outputTypes.add(vout.scriptpubkey_type);
    }
  }

  const allTypes = new Set([...inputTypes, ...outputTypes]);

  // All same type = good for privacy
  if (allTypes.size === 1) {
    findings.push({
      id: "script-uniform",
      severity: "good",
      title: "Uniform script types",
      description:
        "All inputs and outputs use the same script type, making change detection harder. " +
        "An observer cannot use script type mismatch to identify the change output.",
      recommendation:
        "Continue using wallets that maintain consistent address types.",
      scoreImpact: 2,
    });
    return { findings };
  }

  // Mixed types = fingerprinting signal
  const impact = allTypes.size >= 3 ? -3 : -1;
  findings.push({
    id: "script-mixed",
    severity: allTypes.size >= 3 ? "medium" : "low",
    title: `${allTypes.size} different script types in transaction`,
    params: { typeCount: allTypes.size, types: [...allTypes].join(", ") },
    description:
      `This transaction uses ${allTypes.size} different script types (${[...allTypes].join(", ")}). ` +
      "Mixing script types makes change detection easier and can fingerprint the wallet software.",
    recommendation:
      "Use a wallet that keeps the same address format for all outputs. Consistent formats eliminate this signal.",
    scoreImpact: impact,
  });

  return { findings };
};
