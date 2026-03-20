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
}

/** JSON envelope for import/export. */
export interface SavedGraphExport {
  version: 1;
  exportedAt: number;
  graphs: SavedGraph[];
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
): SavedGraph {
  const nodes: SavedGraphNode[] = [];
  for (const [, node] of state.nodes) {
    const saved: SavedGraphNode = { txid: node.txid, depth: node.depth };
    if (node.parentEdge) saved.parentEdge = { ...node.parentEdge };
    if (node.childEdge) saved.childEdge = { ...node.childEdge };
    nodes.push(saved);
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
  if (obj.network !== "mainnet" && obj.network !== "testnet4" && obj.network !== "signet") return false;
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

/** Extract the set of unique txids from a saved graph. */
export function getSavedGraphTxids(saved: SavedGraph): string[] {
  return saved.nodes.map((n) => n.txid);
}
