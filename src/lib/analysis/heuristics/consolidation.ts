import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import { isCoinbase, getAddressedOutputs } from "./tx-utils";

/**
 * Consolidation and Batching Pattern Detection
 *
 * Identifies structural transaction patterns beyond what CIOH covers:
 *
 * 1. Fan-in (consolidation): Many inputs to 1 output. Reveals the full
 *    UTXO set controlled by a single entity. Combined with CIOH, this
 *    is the strongest possible ownership signal.
 *
 * 2. Fan-out (batching): 1 input to many outputs. Common in exchange
 *    batch withdrawals. Informational - reveals entity payment patterns.
 *
 * 3. Cross-type consolidation: Consolidation that combines UTXOs from
 *    different script types (e.g., P2PKH + P2WPKH). Links addresses
 *    from different wallet generations together.
 *
 * Severity scales with input count:
 *   3-5 inputs = medium, 6-10 = high, 10+ = critical
 *
 * Impact is kept modest since CIOH already penalizes multi-input txs.
 * The value here is the pattern label and cross-type detection.
 */
export const analyzeConsolidation: TxHeuristic = (tx) => {
  const findings: Finding[] = [];

  // Skip coinbase
  if (isCoinbase(tx)) return { findings };

  const spendableOutputs = getAddressedOutputs(tx.vout);

  const inputCount = tx.vin.length;
  const outputCount = spendableOutputs.length;

  // ── Fan-in: consolidation (3+ inputs, 1 output) ─────────────────
  if (inputCount >= 3 && outputCount === 1) {
    const severity =
      inputCount >= 10 ? "critical" as const :
      inputCount >= 6 ? "high" as const : "medium" as const;
    const impact = inputCount >= 10 ? -8 : inputCount >= 6 ? -5 : -3;

    findings.push({
      id: "consolidation-fan-in",
      severity,
      confidence: "high",
      title: `Consolidation: ${inputCount} inputs to 1 output`,
      params: { inputCount },
      description:
        `This transaction consolidates ${inputCount} separate UTXOs into a single output. ` +
        "All input addresses are now permanently linked on-chain. An observer can see the entity's " +
        "full UTXO set and total balance at this point in time.",
      recommendation:
        "If consolidation is necessary, run UTXOs through CoinJoin first to break address linkage. " +
        "Consider splitting consolidation across multiple smaller transactions over time.",
      scoreImpact: impact,
    });

    // ── Cross-type consolidation ────────────────────────────────
    const inputScriptTypes = new Set<string>();
    for (const vin of tx.vin) {
      if (vin.prevout?.scriptpubkey_type) {
        inputScriptTypes.add(vin.prevout.scriptpubkey_type);
      }
    }

    if (inputScriptTypes.size >= 2) {
      findings.push({
        id: "consolidation-cross-type",
        severity: "high",
        confidence: "high",
        title: `Cross-type consolidation (${inputScriptTypes.size} script types)`,
        params: {
          typeCount: inputScriptTypes.size,
          types: [...inputScriptTypes].join(", "),
        },
        description:
          `This consolidation combines UTXOs from ${inputScriptTypes.size} different script types ` +
          `(${[...inputScriptTypes].join(", ")}). This links addresses from different wallet ` +
          "generations or software together, giving chain observers additional clustering signals " +
          "beyond basic CIOH.",
        recommendation:
          "Keep UTXOs from different address types separate. If you must consolidate across types, " +
          "CoinJoin each type independently first.",
        scoreImpact: -5,
      });
    }
  }

  // ── Fan-out: batching (1 input, 5+ outputs) ─────────────────────
  if (inputCount === 1 && outputCount >= 5) {
    findings.push({
      id: "consolidation-fan-out",
      severity: "low",
      confidence: "medium",
      title: `Batch payment pattern: 1 input to ${outputCount} outputs`,
      params: { outputCount },
      description:
        `This transaction sends from 1 input to ${outputCount} outputs. ` +
        "This pattern is common in exchange or service batch withdrawals. " +
        "It reveals that the sender is making multiple payments simultaneously, " +
        "which is typical of institutional or automated spending.",
      recommendation:
        "Batch payments are an efficiency optimization but reveal payment patterns. " +
        "For privacy, consider making individual transactions or using PayJoin.",
      scoreImpact: -3,
    });
  }

  // ── I/O ratio anomaly: consolidation disguised as payment ────────
  // A "simple payment" typically has 1-2 inputs and 2 outputs. When a
  // tx has 2 outputs (payment shape) but 5+ inputs, the ratio reveals
  // consolidation behavior merged with a payment.
  if (inputCount >= 5 && outputCount === 2) {
    const ratio = inputCount / outputCount;
    const severity = inputCount >= 10 ? "high" as const : "medium" as const;
    const impact = inputCount >= 10 ? -5 : -3;

    findings.push({
      id: "consolidation-ratio-anomaly",
      severity,
      confidence: "medium",
      title: `Anomalous I/O ratio: ${inputCount} inputs to ${outputCount} outputs`,
      params: { inputCount, outputCount, ratio: Math.round(ratio * 10) / 10 },
      description:
        `This transaction has ${inputCount} inputs but only ${outputCount} outputs (ratio ${ratio.toFixed(1)}:1). ` +
        "A normal payment uses 1-2 inputs. The high input count suggests consolidation " +
        "is being combined with a payment, linking many addresses together unnecessarily.",
      recommendation:
        "Separate consolidation from payments. Consolidate UTXOs in a dedicated transaction " +
        "(ideally after CoinJoin), then make payments from the consolidated output.",
      scoreImpact: impact,
    });
  }

  return { findings };
};
