/**
 * Turn a ConnectionPath into graph nodes to add, anchored on the nodes already
 * in the graph. Pure: no UI imports.
 *
 * Each new node gets an edge to the neighbour it was reached from (forward
 * hop: parentEdge, depth +1; backward hop: childEdge, depth -1), plus an edge
 * to its other neighbour when that one is already placed and the slot is free.
 * Nodes are returned in dependency order, so any prefix is still connected.
 */

import type { MempoolTransaction } from "@/lib/api/types";
import type { GraphNode } from "./graph-reducer";
import type { ConnectionPath } from "./connection-search";

export interface PathPlan {
  nodes: GraphNode[];
  /** Set when no path tx is in the graph: the first hop becomes an extra root. */
  root?: string;
}

/** Attach `tx` to the placed neighbour `nb`, or return null when they are not linked on chain. */
function edgeTo(tx: MempoolTransaction, nb: GraphNode): Pick<GraphNode, "parentEdge" | "childEdge"> | null {
  const spendsNb = tx.vin.findIndex((v) => v.txid === nb.txid);
  if (spendsNb >= 0) return { parentEdge: { fromTxid: nb.txid, outputIndex: tx.vin[spendsNb]!.vout } };
  const fundsNb = nb.tx.vin.findIndex((v) => v.txid === tx.txid);
  if (fundsNb >= 0) return { childEdge: { toTxid: nb.txid, inputIndex: fundsNb } };
  return null;
}

/**
 * Plan the nodes to add for `path`. `txs` must hold every path tx not in the
 * graph; a missing one ends the branch it is on.
 */
export function planPathNodes(
  path: ConnectionPath,
  txs: ReadonlyMap<string, MempoolTransaction>,
  graph: ReadonlyMap<string, GraphNode>,
): PathPlan {
  const ids = path.hops.map((h) => h.txid);
  const placed = new Map<string, GraphNode>();
  const at = (i: number) => graph.get(ids[i]!) ?? placed.get(ids[i]!);
  const nodes: GraphNode[] = [];
  let root: string | undefined;

  if (!ids.some((id) => graph.has(id))) {
    const tx = txs.get(ids[0]!);
    if (!tx) return { nodes };
    root = tx.txid;
    const node: GraphNode = { txid: tx.txid, tx, depth: 0 };
    placed.set(tx.txid, node);
    nodes.push(node);
  }

  const place = (i: number, from: number): boolean => {
    const tx = txs.get(ids[i]!);
    const nb = at(from);
    if (!tx || !nb) return false;
    const edge = edgeTo(tx, nb);
    if (!edge) return false;
    const node: GraphNode = { txid: tx.txid, tx, depth: nb.depth + (edge.parentEdge ? 1 : -1), ...edge };
    // The other neighbour, when already placed, gets the free slot in the other direction
    const other = at(i + (i - from));
    const extra = other ? edgeTo(tx, other) : null;
    if (extra?.parentEdge && !node.parentEdge) node.parentEdge = extra.parentEdge;
    if (extra?.childEdge && !node.childEdge) node.childEdge = extra.childEdge;
    placed.set(tx.txid, node);
    nodes.push(node);
    return true;
  };

  // Grow each run of placed hops outward: rightward runs fill gaps, leftward ones stop at placed hops
  for (let i = 1; i < ids.length; i++) {
    if (!at(i) && at(i - 1)) place(i, i - 1);
  }
  for (let i = ids.length - 2; i >= 0; i--) {
    if (!at(i) && at(i + 1)) place(i, i + 1);
  }
  return { nodes, root };
}
