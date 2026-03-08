import type { MempoolTransaction } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import { analyzeCoinJoin, isCoinJoinFinding } from "../heuristics/coinjoin";

/**
 * Backward chain analysis: examine parent transactions to determine
 * the provenance of each input and adjust scoring accordingly.
 */

export interface BackwardAnalysisResult {
  findings: Finding[];
  /** Inputs that came from CoinJoin (input indices) */
  coinJoinInputs: number[];
  /** Inputs that came from exchange/batch withdrawal (input indices) */
  exchangeInputs: number[];
  /** Inputs that are dust from potential dust attacks (input indices) */
  dustInputs: number[];
}

/**
 * Analyze the provenance of a transaction's inputs by examining parent transactions.
 */
export function analyzeBackward(
  tx: MempoolTransaction,
  parentTxs: Map<number, MempoolTransaction>,
): BackwardAnalysisResult {
  const findings: Finding[] = [];
  const coinJoinInputs: number[] = [];
  const exchangeInputs: number[] = [];
  const dustInputs: number[] = [];

  for (const [inputIdx, parentTx] of parentTxs.entries()) {
    const vin = tx.vin[inputIdx];
    if (!vin || vin.is_coinbase) continue;

    // Check if parent tx is a CoinJoin
    const parentFindings = analyzeCoinJoin(parentTx);
    const parentIsCoinJoin = parentFindings.findings.some(isCoinJoinFinding);
    if (parentIsCoinJoin) {
      coinJoinInputs.push(inputIdx);
    }

    // Check if parent tx looks like an exchange batch withdrawal
    // (1-2 inputs, 10+ outputs, mixed script types)
    if (isExchangeBatch(parentTx)) {
      exchangeInputs.push(inputIdx);
    }

    // Check if the input is likely dust from an attack
    // (tiny value from a parent with many small outputs to diverse addresses)
    const inputValue = vin.prevout?.value ?? 0;
    if (inputValue > 0 && inputValue <= 1000 && isDustAttackParent(parentTx)) {
      dustInputs.push(inputIdx);
    }
  }

  // Generate findings from backward analysis

  if (coinJoinInputs.length > 0) {
    const totalInputs = tx.vin.filter((v) => !v.is_coinbase).length;
    const allFromCoinJoin = coinJoinInputs.length === totalInputs;

    findings.push({
      id: "chain-coinjoin-input",
      severity: "good",
      title: allFromCoinJoin
        ? "All inputs came from CoinJoin"
        : `${coinJoinInputs.length}/${totalInputs} inputs came from CoinJoin`,
      description: allFromCoinJoin
        ? "Every input in this transaction traces back to a CoinJoin transaction, " +
          "providing strong forward privacy for this spend."
        : `${coinJoinInputs.length} of ${totalInputs} inputs came from CoinJoin transactions. ` +
          "Mixing CoinJoin and non-CoinJoin inputs partially undermines the privacy benefit.",
      recommendation: allFromCoinJoin
        ? "Good practice. Continue spending CoinJoin outputs individually for maximum privacy."
        : "Avoid mixing CoinJoin outputs with non-CoinJoin UTXOs. Spend them separately.",
      scoreImpact: allFromCoinJoin ? 8 : 3,
      params: {
        coinJoinCount: coinJoinInputs.length,
        totalInputs,
      },
      confidence: "high",
    });
  }

  if (exchangeInputs.length > 0) {
    findings.push({
      id: "chain-exchange-input",
      severity: "medium",
      title: "Input funds originated from an exchange withdrawal",
      description:
        "One or more inputs trace back to a transaction with exchange batch withdrawal " +
        "characteristics (few inputs, many outputs, mixed address types). Exchange-origin " +
        "funds are linked to KYC identity in the exchange's records.",
      recommendation:
        "Consider CoinJoin before spending exchange-origin funds to break the link " +
        "between your exchange identity and your on-chain activity.",
      scoreImpact: -2,
      params: { exchangeCount: exchangeInputs.length },
      confidence: "medium",
    });
  }

  if (dustInputs.length > 0) {
    findings.push({
      id: "chain-dust-input",
      severity: "critical",
      title: "Potential dust attack input spent",
      description:
        "A tiny input (likely dust) from a transaction that sent many small outputs " +
        "to diverse addresses has been spent in this transaction. This is consistent " +
        "with a dust attack where the attacker can now link this address to the others " +
        "used in this transaction via common input ownership.",
      recommendation:
        "Freeze dust outputs in your wallet's coin control and never spend them. " +
        "If this was unintentional, consider the addresses used in this transaction " +
        "as potentially linked.",
      scoreImpact: -10,
      params: { dustCount: dustInputs.length },
      confidence: "high",
    });
  }

  return { findings, coinJoinInputs, exchangeInputs, dustInputs };
}

/** Detect exchange batch withdrawal pattern (structural, no address database) */
function isExchangeBatch(tx: MempoolTransaction): boolean {
  if (tx.vin.length > 2) return false;
  const spendable = tx.vout.filter((o) => !o.scriptpubkey.startsWith("6a"));
  if (spendable.length < 10) return false;

  // Check for mixed script types (2+ types - exchanges serve diverse customers)
  const types = new Set(spendable.map((o) => o.scriptpubkey_type));
  if (types.size < 2) return false;

  return true;
}

/** Detect dust attack parent: many small outputs to diverse addresses */
function isDustAttackParent(tx: MempoolTransaction): boolean {
  const spendable = tx.vout.filter((o) => !o.scriptpubkey.startsWith("6a"));
  if (spendable.length < 10) return false;

  // Count small outputs (<= 1000 sats)
  const smallOutputs = spendable.filter((o) => o.value <= 1000);
  if (smallOutputs.length < 5) return false;

  // Check for diverse addresses
  const addresses = new Set(
    spendable
      .map((o) => o.scriptpubkey_address)
      .filter(Boolean),
  );
  if (addresses.size < spendable.length * 0.8) return false;

  return true;
}
