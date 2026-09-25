/**
 * Pure data-transformation function that builds the Sankey graph for CoinJoinChart.
 *
 * Extracted from CoinJoinChart.tsx to keep the component thin and testable.
 */

import { formatSats } from "@/lib/format";
import { truncateId } from "@/lib/constants";
import { countOutputValues } from "@/lib/analysis/heuristics/tx-utils";
import { matchEntitySync } from "@/lib/analysis/entity-filter/entity-match";
import type { BaseNodeDatum, LinkDatum } from "./shared/sankeyTypes";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { SankeyExtraProperties, SankeyGraph } from "d3-sankey";

// ---------------------------------------------------------------------------
// CoinJoin-specific node type (extends shared base)
// ---------------------------------------------------------------------------

export interface CoinJoinNodeDatum extends BaseNodeDatum {
  side: "input" | "output" | "mixer";
  tierValue?: number;
  tierCount?: number;
  /** Number of outputs in this tier that were consolidated (spent together post-mix). */
  consolidatedCount?: number;
  /** Parent txid shared with other inputs (input-side consolidation). */
  sharedParentTxid?: string;
  /** How many inputs share this parent txid. */
  sharedParentCount?: number;
}

// ---------------------------------------------------------------------------
// Denomination tier grouping
// ---------------------------------------------------------------------------

export interface DenomTierGroups {
  tiers: { value: number; count: number }[];
  otherValues: number[];
}

/** Group outputs by denomination tier (equal-value groups with 2+ outputs). */
export function buildDenomGroups(vout: MempoolTransaction["vout"]): DenomTierGroups {
  const valueCounts = countOutputValues(vout);
  const tiers: { value: number; count: number }[] = [];
  const others: number[] = [];
  for (const [value, count] of valueCounts) {
    if (count >= 2) {
      tiers.push({ value, count });
    } else {
      others.push(value);
    }
  }
  tiers.sort((a, b) => b.value - a.value);
  return { tiers, otherValues: others };
}

// ---------------------------------------------------------------------------
// Consolidation detection
// ---------------------------------------------------------------------------

/** A group of outputs that were consolidated (spent in the same child tx). */
export interface ConsolidationGroup {
  childTxid: string;
  outputIndices: number[];
}

export interface ConsolidationData {
  counts: Map<number, number>;
  groups: Map<number, ConsolidationGroup[]>;
}

/** Detect post-mix consolidation: outputs spent together in the same child tx. */
export function buildConsolidationData(
  outspends: MempoolOutspend[] | null | undefined,
  vout: MempoolTransaction["vout"],
): ConsolidationData {
  const empty: ConsolidationData = { counts: new Map(), groups: new Map() };
  if (!outspends) return empty;

  // Group output indices by spending txid
  const byChild = new Map<string, number[]>();
  for (let i = 0; i < outspends.length; i++) {
    const os = outspends[i];
    if (os?.spent && os.txid) {
      const group = byChild.get(os.txid) ?? [];
      group.push(i);
      byChild.set(os.txid, group);
    }
  }

  // Find groups where 2+ outputs share a spending tx
  const consolidatedGroups: ConsolidationGroup[] = [];
  const consolidated = new Set<number>();
  for (const [childTxid, indices] of byChild) {
    if (indices.length >= 2) {
      consolidatedGroups.push({ childTxid, outputIndices: indices });
      for (const idx of indices) consolidated.add(idx);
    }
  }

  // Aggregate per tier value
  const counts = new Map<number, number>();
  const groups = new Map<number, ConsolidationGroup[]>();
  for (const idx of consolidated) {
    const val = vout[idx]?.value;
    if (val != null) counts.set(val, (counts.get(val) ?? 0) + 1);
  }
  for (const group of consolidatedGroups) {
    const tierValues = new Set(group.outputIndices.map((i) => vout[i]?.value).filter((v): v is number => v != null));
    for (const tv of tierValues) {
      const list = groups.get(tv) ?? [];
      list.push(group);
      groups.set(tv, list);
    }
  }
  return { counts, groups };
}

// ---------------------------------------------------------------------------
// Input consolidation detection
// ---------------------------------------------------------------------------

export interface InputConsolidationEntry {
  parentTxid: string;
  count: number;
}

/** Detect input-side consolidation: inputs from the same parent tx. */
export function buildInputConsolidation(
  vin: MempoolTransaction["vin"],
): Map<number, InputConsolidationEntry> {
  const byParent = new Map<string, number[]>();
  for (let i = 0; i < vin.length; i++) {
    const parentTxid = vin[i]?.txid;
    if (!parentTxid) continue;
    const group = byParent.get(parentTxid) ?? [];
    group.push(i);
    byParent.set(parentTxid, group);
  }
  const result = new Map<number, InputConsolidationEntry>();
  for (const [parentTxid, indices] of byParent) {
    if (indices.length >= 2) {
      for (const idx of indices) {
        result.set(idx, { parentTxid, count: indices.length });
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Graph builder
// ---------------------------------------------------------------------------

/** Translate function signature (subset of react-i18next's t). */
export type TFn = (key: string, opts?: Record<string, unknown>) => string;

export interface BuildCoinJoinGraphOptions {
  showAllInputs: boolean;
  aggregateInputs: boolean;
  maxOutputNodes: number;
  denomGroups: DenomTierGroups;
  consolidationData: ConsolidationData;
  inputConsolidation: Map<number, InputConsolidationEntry>;
  t: TFn;
  lang: string;
}

export interface CoinJoinGraphResult {
  graph: SankeyGraph<CoinJoinNodeDatum, LinkDatum> & SankeyExtraProperties;
  hiddenInputCount: number;
}

const MAX_DISPLAY = 50;

/** Build the Sankey node/link graph for a CoinJoin structure diagram. */
export function buildCoinJoinGraph(
  tx: MempoolTransaction,
  options: BuildCoinJoinGraphOptions,
): CoinJoinGraphResult {
  const {
    showAllInputs,
    aggregateInputs,
    maxOutputNodes,
    denomGroups,
    consolidationData,
    inputConsolidation,
    t,
    lang,
  } = options;

  const nodes: CoinJoinNodeDatum[] = [];
  const links: LinkDatum[] = [];
  let hiddenIn = 0;

  const totalInputValue = tx.vin.reduce((s, v) => s + (v.prevout?.value ?? 0), 0);

  if (aggregateInputs) {
    const aggConsolidated = inputConsolidation.size;
    nodes.push({
      id: "in-agg",
      label: t("viz.coinjoin.inputSummary", {
        count: tx.vin.length,
        defaultValue: `${tx.vin.length} participants`,
      }),
      value: Math.max(totalInputValue, 1),
      side: "input",
      consolidatedCount: aggConsolidated > 0 ? aggConsolidated : undefined,
    });
  } else {
    const displayInputs = showAllInputs ? tx.vin : tx.vin.slice(0, MAX_DISPLAY);
    hiddenIn = tx.vin.length - displayInputs.length;

    for (const [i, vin] of displayInputs.entries()) {
      const addr = vin.prevout?.scriptpubkey_address;
      const val = vin.prevout?.value ?? 0;
      const ic = inputConsolidation.get(i);
      const entity = addr ? matchEntitySync(addr) : null;
      nodes.push({
        id: `in-${i}`,
        label: truncateId(addr ?? "?", 5),
        fullAddress: addr,
        value: Math.max(val, 1),
        side: "input",
        sharedParentTxid: ic?.parentTxid,
        sharedParentCount: ic?.count,
        entityName: entity?.entityName,
      });
    }
  }

  nodes.push({
    id: "mixer",
    label: t("viz.coinjoin.mixingZone", { defaultValue: "Mixing zone" }),
    value: Math.max(totalInputValue, 1),
    side: "mixer",
  });

  // Output nodes: group by denomination tier, capped for readability
  const outputNodes: CoinJoinNodeDatum[] = [];

  const sortedTiers = [...denomGroups.tiers].sort((a, b) => b.count - a.count);
  const displayTiers = sortedTiers.slice(0, maxOutputNodes - 1);
  const remainingTiers = sortedTiers.slice(maxOutputNodes - 1);

  for (const tier of displayTiers) {
    const cc = consolidationData.counts.get(tier.value) ?? 0;
    outputNodes.push({
      id: `tier-${tier.value}`,
      label: `${tier.count}x ${formatSats(tier.value, lang)}`,
      value: tier.value * tier.count,
      side: "output",
      tierValue: tier.value,
      tierCount: tier.count,
      consolidatedCount: cc > 0 ? cc : undefined,
    });
  }

  // Aggregate remaining tiers + "other" unique outputs into a single summary
  const remainingTierOutputCount = remainingTiers.reduce((s, tier) => s + tier.count, 0);
  const remainingTierValue = remainingTiers.reduce((s, tier) => s + tier.value * tier.count, 0);
  const otherTotalValue = denomGroups.otherValues.reduce((s, v) => s + v, 0);
  const otherCount = denomGroups.otherValues.length;
  const aggregatedCount = remainingTierOutputCount + otherCount;
  const aggregatedValue = remainingTierValue + otherTotalValue;

  if (aggregatedCount > 0) {
    outputNodes.push({
      id: "other-agg",
      label: t("viz.coinjoin.otherOutputs", {
        count: aggregatedCount,
        defaultValue: `${aggregatedCount} other outputs`,
      }),
      value: Math.max(aggregatedValue, 1),
      side: "output",
    });
  }

  nodes.push(...outputNodes);

  // Links: all inputs -> mixer
  if (aggregateInputs) {
    links.push({
      source: "in-agg",
      target: "mixer",
      value: Math.max(1, totalInputValue),
    });
  } else {
    const linkInputs = showAllInputs ? tx.vin : tx.vin.slice(0, MAX_DISPLAY);
    for (const [i, input] of linkInputs.entries()) {
      links.push({
        source: `in-${i}`,
        target: "mixer",
        value: Math.max(1, input.prevout?.value ?? 1),
      });
    }
  }

  // Links: mixer -> outputs
  for (const outNode of outputNodes) {
    links.push({
      source: "mixer",
      target: outNode.id,
      value: Math.max(1, outNode.value),
    });
  }

  const g: SankeyGraph<CoinJoinNodeDatum, LinkDatum> & SankeyExtraProperties = { nodes, links };
  return { graph: g, hiddenInputCount: hiddenIn };
}
