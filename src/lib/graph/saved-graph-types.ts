/**
 * Types and serialization helpers for saved graph persistence.
 *
 * Saved graphs store only the graph topology (txids, depths, edges)
 * without MempoolTransaction objects - those are re-fetched on load.
 */

import type { BitcoinNetwork } from "@/lib/bitcoin/networks";
import type { GraphState } from "./graph-reducer";

// ─── Serializable types ─────────────────────────────────────────────

/** A graph node stripped of MempoolTransaction data. */
export interface SavedGraphNode {
  txid: string;
  depth: number;
  parentEdge?: { fromTxid: string; outputIndex: number };
  childEdge?: { toTxid: string; inputIndex: number };
}

/** An annotation placed on the graph canvas. */
export interface GraphAnnotation {
  id: string;
  type: "note" | "rect" | "circle";
  x: number;
  y: number;
  /** Short title (max 20 chars) - encoded in share URL. */
  title: string;
  /** Full body text (max 5000 chars) - workspace only, not in URL. */
  body: string;
  width?: number;
  height?: number;
  radius?: number;
  color?: string;
  connectedNodeTxid?: string;
}

/** A named, persisted graph snapshot. */
export interface SavedGraph {
  id: string;
  name: string;
  savedAt: number;
  network: BitcoinNetwork;
  rootTxid: string;
  rootTxids: string[];
  nodes: SavedGraphNode[];
  viewTransform?: { x: number; y: number; scale: number };
  changeOutputs?: string[];
  /** User-defined node positions from dragging. */
  nodePositions?: Record<string, { x: number; y: number }>;
  /** Canvas annotations (notes, rectangles, circles). */
  annotations?: GraphAnnotation[];
  /** User labels on nodes, keyed by txid. */
  nodeLabels?: Record<string, string>;
  /** User labels on edges, keyed by "fromTxid->toTxid". */
  edgeLabels?: Record<string, string>;
}

// ─── Serialization ──────────────────────────────────────────────────

const TXID_HEX = /^[a-fA-F0-9]{64}$/;

/** Serialize live graph state into a SavedGraph (strips tx objects). */
export function serializeGraph(
  state: GraphState,
  name: string,
  network: BitcoinNetwork,
  viewTransform?: { x: number; y: number; scale: number },
  changeOutputs?: Set<string>,
  nodePositions?: Map<string, { x: number; y: number }>,
  annotations?: GraphAnnotation[],
  nodeLabels?: Map<string, string>,
  edgeLabels?: Map<string, string>,
): SavedGraph {
  const nodes: SavedGraphNode[] = [];
  for (const [, node] of state.nodes) {
    const saved: SavedGraphNode = { txid: node.txid, depth: node.depth };
    if (node.parentEdge) saved.parentEdge = { ...node.parentEdge };
    if (node.childEdge) saved.childEdge = { ...node.childEdge };
    nodes.push(saved);
  }

  // Convert Map to Record for JSON serialization
  let posRecord: Record<string, { x: number; y: number }> | undefined;
  if (nodePositions && nodePositions.size > 0) {
    posRecord = {};
    for (const [txid, pos] of nodePositions) posRecord[txid] = pos;
  }

  return {
    id: crypto.randomUUID(),
    name,
    savedAt: Date.now(),
    network,
    rootTxid: state.rootTxid,
    rootTxids: [...state.rootTxids],
    nodes,
    viewTransform: viewTransform ? { ...viewTransform } : undefined,
    changeOutputs: changeOutputs?.size ? [...changeOutputs] : undefined,
    nodePositions: posRecord,
    annotations: annotations?.length ? annotations : undefined,
    nodeLabels: nodeLabels?.size ? Object.fromEntries(nodeLabels) : undefined,
    edgeLabels: edgeLabels?.size ? Object.fromEntries(edgeLabels) : undefined,
  };
}

// ─── Validation ─────────────────────────────────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isValidEdge(e: unknown): boolean {
  if (!isObj(e)) return false;
  return typeof e.fromTxid === "string" || typeof e.toTxid === "string";
}

/** Validate that an unknown value is a structurally sound SavedGraph. */
export function validateSavedGraph(obj: unknown): obj is SavedGraph {
  if (!isObj(obj)) return false;
  if (typeof obj.id !== "string" || !obj.id) return false;
  if (typeof obj.name !== "string") return false;
  if (typeof obj.savedAt !== "number") return false;
  if (
    obj.network !== "mainnet" &&
    obj.network !== "testnet4" &&
    obj.network !== "testnet3" &&
    obj.network !== "signet"
  ) return false;
  if (typeof obj.rootTxid !== "string" || !TXID_HEX.test(obj.rootTxid)) return false;
  if (!Array.isArray(obj.rootTxids)) return false;
  if (!Array.isArray(obj.nodes) || obj.nodes.length === 0) return false;

  for (const n of obj.nodes) {
    if (!isObj(n)) return false;
    if (typeof n.txid !== "string" || !TXID_HEX.test(n.txid)) return false;
    if (typeof n.depth !== "number") return false;
    if (n.parentEdge !== undefined && !isValidEdge(n.parentEdge)) return false;
    if (n.childEdge !== undefined && !isValidEdge(n.childEdge)) return false;
  }

  return true;
}
