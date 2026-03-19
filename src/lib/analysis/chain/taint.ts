import type { MempoolTransaction } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import type { TraceLayer } from "./recursive-trace";
import { getSpendableOutputs } from "../heuristics/tx-utils";

/**
 * Taint Analysis
 *
 * Tracks the flow of "tainted" value through the transaction graph.
 * Taint propagates proportionally: if 50% of a tx's input value comes
 * from a tainted source, each output inherits 50% taint.
 *
 * Uses the "haircut" (proportional) method rather than "poison pill"
 * (binary) to provide a more nuanced view of fund origin mixing.
 *
 * Taint sources:
 * - Known entity addresses (exchanges, mining, darknet, OFAC)
 * - CoinJoin outputs (positive taint - privacy gain)
 * - User-specified addresses (future feature)
 */

interface TaintResult {
  findings: Finding[];
  /** Per-output taint fractions for the analyzed tx (0-1, where 1 = fully tainted) */
  outputTaint: Map<number, TaintBreakdown>;
  /** Per-input source breakdown */
  inputSources: Map<number, TaintSource[]>;
}

interface TaintBreakdown {
  /** Total taint fraction (0-1) */
  total: number;
  /** Breakdown by source category */
  sources: Map<string, number>;
}

interface TaintSource {
  category: string;
  entityName?: string;
  fraction: number;
  hops: number;
}

/**
 * Analyze backward taint: what fraction of the analyzed tx's value
 * originates from known entity sources?
 *
 * @param tx - The transaction being analyzed
 * @param backwardLayers - Trace layers from recursive backward tracing
 * @param entityChecker - Function to check if an address belongs to a known entity
 */
export function analyzeBackwardTaint(
  tx: MempoolTransaction,
  backwardLayers: TraceLayer[],
  entityChecker: (address: string) => { category: string; entityName: string } | null,
): TaintResult {
  const findings: Finding[] = [];
  const outputTaint = new Map<number, TaintBreakdown>();
  const inputSources = new Map<number, TaintSource[]>();

  if (backwardLayers.length === 0) {
    return { findings, outputTaint, inputSources };
  }

  // Build a map of all traced transactions for quick lookup
  const allTxs = new Map<string, MempoolTransaction>();
  for (const layer of backwardLayers) {
    for (const [txid, ltx] of layer.txs) {
      allTxs.set(txid, ltx);
    }
  }

  // For each input of the analyzed tx, trace backward and calculate taint
  const totalInputValue = tx.vin.reduce(
    (sum, vin) => sum + (vin.prevout?.value ?? 0), 0,
  );
  if (totalInputValue === 0) return { findings, outputTaint, inputSources };

  // Aggregate taint across all inputs
  const aggregatedTaint = new Map<string, number>();
  let totalTaintFraction = 0;

  for (let i = 0; i < tx.vin.length; i++) {
    const vin = tx.vin[i];
    if (vin.is_coinbase) continue;
    const inputValue = vin.prevout?.value ?? 0;
    if (inputValue === 0) continue;
    const inputWeight = inputValue / totalInputValue;

    const sources: TaintSource[] = [];

    // Check direct entity match on the input address first
    const inputAddr = vin.prevout?.scriptpubkey_address;
    let directMatch = false;
    if (inputAddr) {
      const entity = entityChecker(inputAddr);
      if (entity) {
        directMatch = true;
        const category = entity.category;
        aggregatedTaint.set(category, (aggregatedTaint.get(category) ?? 0) + inputWeight);
        totalTaintFraction += inputWeight;
        sources.push({
          category,
          entityName: entity.entityName,
          fraction: inputWeight,
          hops: 0,
        });
      }
    }

    // Only trace parent tx taint if the input address did not directly match an entity.
    // This prevents double-counting: a single-input tx from an entity would otherwise
    // get taint from both the direct match AND the parent's input check.
    if (!directMatch) {
      const parentTx = allTxs.get(vin.txid);
      if (parentTx) {
        const parentInputTaint = computeParentTaint(parentTx, entityChecker);
        for (const [category, fraction] of parentInputTaint) {
          const weighted = fraction * inputWeight;
          aggregatedTaint.set(category, (aggregatedTaint.get(category) ?? 0) + weighted);
          totalTaintFraction += weighted;
          sources.push({ category, fraction: weighted, hops: 1 });
        }
      }
    }

    if (sources.length > 0) {
      inputSources.set(i, sources);
    }
  }

  // Propagate taint to outputs (proportional / haircut method)
  const spendable = getSpendableOutputs(tx.vout);
  const totalOutputValue = spendable.reduce((sum, o) => sum + o.value, 0);

  if (totalOutputValue > 0 && aggregatedTaint.size > 0) {
    for (let i = 0; i < tx.vout.length; i++) {
      const vout = tx.vout[i];
      if (vout.scriptpubkey_type === "op_return") continue;
      // Proportional: each output gets the same taint fraction as the overall tx
      const breakdown: TaintBreakdown = {
        total: Math.min(1, totalTaintFraction),
        sources: new Map(aggregatedTaint),
      };
      outputTaint.set(i, breakdown);
    }
  }

  // Generate findings
  if (totalTaintFraction > 0) {
    const clampedTaint = Math.min(totalTaintFraction, 1.0);
    const pct = Math.round(clampedTaint * 100);
    const topSources = [...aggregatedTaint.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const sourceDesc = topSources
      .map(([cat, frac]) => `${Math.round(frac * 100)}% ${cat}`)
      .join(", ");

    const severity = totalTaintFraction >= 0.8 ? "high" as const
      : totalTaintFraction >= 0.3 ? "medium" as const
      : "low" as const;
    const impact = totalTaintFraction >= 0.8 ? -5
      : totalTaintFraction >= 0.3 ? -3
      : -1;

    findings.push({
      id: "chain-taint-backward",
      severity,
      confidence: "medium",
      title: `${pct}% of input value traceable to known entities`,
      description:
        `Backward taint analysis shows ${pct}% of this transaction's input value ` +
        `can be traced to known entities: ${sourceDesc}. ` +
        "This means chain analysis firms can probabilistically link a significant " +
        "portion of the funds to identified sources.",
      recommendation:
        totalTaintFraction >= 0.5
          ? "A majority of funds are traceable to known entities. CoinJoin before spending " +
            "can break the deterministic chain, though the entity's records still exist."
          : "Some funds are traceable. Consider the privacy implications based on your threat model.",
      scoreImpact: impact,
      params: {
        taintPct: pct,
        sourceCount: aggregatedTaint.size,
      },
    });
  }

  return { findings, outputTaint, inputSources };
}

/**
 * Compute taint for a parent transaction by checking its inputs against entity addresses.
 * This is a simplified single-hop taint check (not recursive) to avoid O(n^depth) blowup.
 */
function computeParentTaint(
  parentTx: MempoolTransaction,
  entityChecker: (address: string) => { category: string; entityName: string } | null,
): Map<string, number> {
  const taint = new Map<string, number>();

  const totalInput = parentTx.vin.reduce(
    (sum, vin) => sum + (vin.prevout?.value ?? 0), 0,
  );
  if (totalInput === 0) return taint;

  for (const vin of parentTx.vin) {
    if (vin.is_coinbase) continue;
    const addr = vin.prevout?.scriptpubkey_address;
    if (!addr) continue;

    const entity = entityChecker(addr);
    if (entity) {
      const weight = (vin.prevout?.value ?? 0) / totalInput;
      taint.set(entity.category, (taint.get(entity.category) ?? 0) + weight);
    }
  }

  return taint;
}
