/**
 * Pure data-transformation function that builds the Sankey graph for TxFlowDiagram.
 *
 * Extracted from FlowChart.tsx to keep the component thin and testable.
 */

import { SEVERITY_HEX } from "./shared/svgConstants";
import { SVG_COLORS, GRADIENT_COLORS } from "./shared/svgConstants";
import { DUST_THRESHOLD } from "@/lib/constants";
import { truncateId } from "@/lib/constants";
import { countOutputValues, isOpReturnOutput } from "@/lib/analysis/heuristics/tx-utils";
import { matchEntitySync } from "@/lib/analysis/entity-filter/entity-match";
import { analyzeMultisigDetection } from "@/lib/analysis/heuristics/multisig-detection";
import { computeDenomGrouping } from "./shared/sankeyTypes";
import type { BaseNodeDatum, LinkDatum, DenomGrouping } from "./shared/sankeyTypes";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import type { SankeyExtraProperties, SankeyGraph } from "d3-sankey";
import type { FindingId } from "@/lib/analysis/finding-metadata";

// ---------------------------------------------------------------------------
// FlowChart-specific node type (extends shared base)
// ---------------------------------------------------------------------------

export interface FlowNodeDatum extends BaseNodeDatum {
  /** Original sats value for display (Sankey may overwrite `value` with link totals). */
  displayValue: number;
  side: "input" | "output" | "fee";
  annotation?: string;
  annotationColor?: string;
  annotationReason?: string;
  annotationFindingId?: string;
  anonSet?: number;
  anonColor?: string;
  /** Whether this output has been spent (null = unknown). */
  spent?: boolean | null;
}

export const MAX_DISPLAY = 50;

const ANON_COLORS = [
  SVG_COLORS.good,
  SVG_COLORS.bitcoin,
  GRADIENT_COLORS.inputLight,
  SVG_COLORS.medium,
  SVG_COLORS.high,
];

// ---------------------------------------------------------------------------
// Change detection
// ---------------------------------------------------------------------------

export interface ChangeInfo {
  findingId: string;
  reason: string;
}

/** Translate function signature (subset of react-i18next's t). */
export type TFn = (key: string, opts?: Record<string, unknown>) => string;

/**
 * Build a map from vout index to change annotation info, driven by findings
 * with a self-address fallback.
 */
export function buildChangeOutputMap(
  tx: MempoolTransaction,
  findings: Finding[] | undefined,
  t: TFn,
): Map<number, ChangeInfo> {
  const map = new Map<number, ChangeInfo>();

  if (findings) {
    for (const f of findings) {
      if (f.id === "h2-change-detected" && f.params?.["changeIndex"] != null) {
        const signalKeyMap: Record<string, string> = {
          address_type: t("viz.flow.changeAddressType", { defaultValue: "address type match" }),
          round_amount: t("viz.flow.changeRoundAmount", { defaultValue: "round amount" }),
          value_disparity: t("viz.flow.changeValueDisparity", { defaultValue: "value disparity" }),
          unnecessary_input: t("viz.flow.changeUnnecessaryInput", { defaultValue: "unnecessary inputs" }),
        };
        const keys = String(f.params["signalKeys"] ?? "").split(",").filter(Boolean);
        const reason = keys.map((k) => signalKeyMap[k] ?? k).join(", ")
          || t("viz.flow.changeAddressType", { defaultValue: "address type match" });
        map.set(Number(f.params["changeIndex"]), { findingId: f.id, reason });
      }
      if (f.id === "h2-self-send" && f.params?.["selfSendIndices"]) {
        const reason = t("viz.flow.changeSelfSend", { defaultValue: "sent to input address" });
        for (const idx of String(f.params["selfSendIndices"]).split(",")) {
          map.set(Number(idx), { findingId: f.id, reason });
        }
      }
    }
  }

  // Fallback: self-address matching
  if (map.size === 0) {
    const inputAddrs = new Set(
      tx.vin.map((v) => v.prevout?.scriptpubkey_address).filter(Boolean) as string[],
    );
    for (const [i, { scriptpubkey_address: a }] of tx.vout.entries()) {
      if (a && inputAddrs.has(a)) {
        map.set(i, {
          findingId: "h2-self-send",
          reason: t("viz.flow.changeSelfSend", { defaultValue: "sent to input address" }),
        });
      }
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Dust detection
// ---------------------------------------------------------------------------

/** Build a set of output indices flagged as dust. */
export function buildDustOutputIndices(
  tx: MempoolTransaction,
  findings: Finding[] | undefined,
): Set<number> {
  const indices = new Set<number>();

  if (findings) {
    for (const f of findings) {
      if ((f.id === "dust-attack" || f.id === "dust-outputs") && f.params?.["dustIndices"]) {
        for (const idx of String(f.params["dustIndices"]).split(",")) {
          indices.add(Number(idx));
        }
      }
    }
  }

  if (indices.size === 0) {
    for (const [i, out] of tx.vout.entries()) {
      if (out.value > 0 && out.value < DUST_THRESHOLD && !isOpReturnOutput(out)) {
        indices.add(i);
      }
    }
  }

  return indices;
}

// ---------------------------------------------------------------------------
// Anon set computation
// ---------------------------------------------------------------------------

/** Compute anon-set denomination grouping for a transaction's outputs. */
export function buildAnonSets(vout: MempoolTransaction["vout"]): DenomGrouping {
  const valueCounts = countOutputValues(vout);
  return computeDenomGrouping(valueCounts, ANON_COLORS);
}

// ---------------------------------------------------------------------------
// Boltzmann lookup
// ---------------------------------------------------------------------------

export interface BoltzmannLookup {
  getProb: (displayInIdx: number, displayOutIdx: number) => number;
  timedOut: boolean;
}

interface BoltzmannInput {
  matLnkProbabilities: number[][];
  timedOut: boolean;
}

/** Build a lookup for Boltzmann link probabilities. */
export function buildBoltzmannLookup(
  boltzmannResult: BoltzmannInput | null | undefined,
  linkabilityMode: boolean,
  _tx?: MempoolTransaction,
): BoltzmannLookup | null {
  if (!boltzmannResult || !linkabilityMode) return null;
  // Matrices are indexed by raw tx position (rows = vout, columns = vin);
  // see expandMatrixToTx in boltzmann-detection.
  const mat = boltzmannResult.matLnkProbabilities;
  return {
    getProb: (displayInIdx: number, displayOutIdx: number): number => mat[displayOutIdx]?.[displayInIdx] ?? 0,
    timedOut: boltzmannResult.timedOut,
  };
}

// ---------------------------------------------------------------------------
// Graph builder
// ---------------------------------------------------------------------------

export interface BuildFlowGraphOptions {
  showAllInputs: boolean;
  showAllOutputs: boolean;
  changeOutputMap: Map<number, ChangeInfo>;
  dustOutputIndices: Set<number>;
  anonSets: DenomGrouping;
  outspends?: MempoolOutspend[] | null;
  t: TFn;
}

export interface FlowGraphResult {
  graph: SankeyGraph<FlowNodeDatum, LinkDatum> & SankeyExtraProperties;
  hiddenInputCount: number;
  hiddenOutputCount: number;
}

/** Build the Sankey node/link graph for a transaction flow diagram. */
export function buildFlowGraph(
  tx: MempoolTransaction,
  options: BuildFlowGraphOptions,
): FlowGraphResult {
  const {
    showAllInputs,
    showAllOutputs,
    changeOutputMap,
    dustOutputIndices,
    anonSets,
    outspends,
    t,
  } = options;

  const displayInputs = showAllInputs ? tx.vin : tx.vin.slice(0, MAX_DISPLAY);
  const displayOutputs = showAllOutputs ? tx.vout : tx.vout.slice(0, MAX_DISPLAY);
  const hiddenIn = tx.vin.length - displayInputs.length;
  const hiddenOut = tx.vout.length - displayOutputs.length;

  const totalOutputValue = displayOutputs.reduce((s, v) => s + v.value, 0);

  // Heuristic entity detection (HodlHodl, Bisq) - labels fee addresses
  const heuristicEntityMap: Record<string, string> = {};
  const HEURISTIC_LABELS: Partial<Record<FindingId, string>> = { "h17-hodlhodl": "HodlHodl", "h17-bisq": "Bisq" };
  const msResult = analyzeMultisigDetection(tx);
  for (const f of msResult.findings) {
    const label = HEURISTIC_LABELS[f.id];
    if (label && f.params) {
      const feeAddr = f.params.feeAddress;
      if (typeof feeAddr === "string") heuristicEntityMap[feeAddr] = label;
    }
  }

  const nodes: FlowNodeDatum[] = [];
  const links: LinkDatum[] = [];

  // Input nodes
  for (const [i, vin] of displayInputs.entries()) {
    const addr = vin.prevout?.scriptpubkey_address;
    const val = vin.prevout?.value ?? 0;
    const entity = addr ? matchEntitySync(addr) : null;
    nodes.push({
      id: `in-${i}`,
      label: vin.is_coinbase ? "coinbase" : truncateId(addr ?? "?", 5),
      fullAddress: addr,
      value: Math.max(val, 1),
      displayValue: val,
      side: "input",
      entityName: entity?.entityName,
    });
  }

  // Output nodes
  for (const [i, vout] of displayOutputs.entries()) {
    const addr = vout.scriptpubkey_address;
    const val = vout.value;
    const anonCount = anonSets.valueCounts.get(val) ?? 1;
    const anonColor = anonSets.groupColors.get(val);

    let annotation: string | undefined;
    let annotationColor: string | undefined;
    let annotationReason: string | undefined;
    let annotationFindingId: string | undefined;

    const changeInfo = changeOutputMap.get(i);
    if (changeInfo) {
      annotation = t("viz.flow.change", { defaultValue: "change" });
      annotationColor = SEVERITY_HEX.high;
      annotationReason = changeInfo.reason;
      annotationFindingId = changeInfo.findingId;
    } else if (dustOutputIndices.has(i)) {
      annotation = t("viz.flow.dust", { defaultValue: "dust" });
      annotationColor = SEVERITY_HEX.critical;
    }

    const outEntity = addr ? matchEntitySync(addr) : null;
    const heuristicLabel = addr ? heuristicEntityMap[addr] : undefined;
    nodes.push({
      id: `out-${i}`,
      label: isOpReturnOutput(vout)
        ? "OP_RETURN"
        : truncateId(addr ?? vout.scriptpubkey_type, 5),
      fullAddress: addr,
      value: Math.max(val, 1),
      displayValue: val,
      side: "output",
      annotation,
      annotationColor,
      annotationReason,
      annotationFindingId,
      anonSet: anonCount >= 2 ? anonCount : undefined,
      anonColor,
      spent: outspends?.[i]?.spent ?? null,
      entityName: outEntity?.entityName ?? heuristicLabel,
    });
  }

  // Links
  const outputValues = displayOutputs.map((o) => o.value);
  const maxOut = Math.max(...outputValues, 1);
  const minPositive = Math.min(...outputValues.filter((v) => v > 0), maxOut);
  const useCompression = maxOut / minPositive > 10;

  for (const [i, input] of displayInputs.entries()) {
    const inputVal = input.prevout?.value ?? 0;
    if (inputVal === 0) continue;

    const scaledTotal = useCompression
      ? displayOutputs.reduce((s, o) => s + Math.sqrt(o.value), 0)
      : totalOutputValue;

    for (const [j, { value: outVal }] of displayOutputs.entries()) {
      const scaledOut = useCompression ? Math.sqrt(outVal) : outVal;
      const proportion = scaledTotal > 0 ? scaledOut / scaledTotal : 1 / displayOutputs.length;
      const linkVal = Math.max(1, Math.round(inputVal * proportion));
      links.push({ source: `in-${i}`, target: `out-${j}`, value: linkVal });
    }
  }

  // Coinbase fallback
  if (links.length === 0 && nodes.length > 1) {
    for (const [j, out] of displayOutputs.entries()) {
      links.push({ source: "in-0", target: `out-${j}`, value: Math.max(1, out.value) });
    }
    if (nodes[0]) {
      nodes[0].value = totalOutputValue + tx.fee;
      nodes[0].displayValue = totalOutputValue + tx.fee;
    }
  }

  const g: SankeyGraph<FlowNodeDatum, LinkDatum> & SankeyExtraProperties = { nodes, links };
  return { graph: g, hiddenInputCount: hiddenIn, hiddenOutputCount: hiddenOut };
}
