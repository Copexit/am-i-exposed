/**
 * Load a saved graph by re-fetching MempoolTransaction objects for all txids.
 *
 * Saved graphs only store topology (txids + edges). This module
 * batch-fetches the full transaction data from the mempool API.
 */

import type { GraphNode, GraphExpansionFetcher } from "./graph-reducer";
import type { SavedGraph, SavedGraphNode } from "./saved-graph-types";

export interface GraphLoadResult {
  nodes: Map<string, GraphNode>;
  rootTxid: string;
  rootTxids: Set<string>;
  failedTxids: string[];
}

const CONCURRENCY = 5;

/**
 * Re-fetch all transactions and hydrate a SavedGraph into live GraphNodes.
 * Fetches in parallel batches of CONCURRENCY. Nodes whose tx fails to load
 * are skipped, and edges referencing missing nodes are cleared.
 */
export async function loadSavedGraph(
  saved: Pick<SavedGraph, "nodes" | "rootTxid" | "rootTxids">,
  fetcher: GraphExpansionFetcher,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<GraphLoadResult> {
  const total = saved.nodes.length;
  let loaded = 0;
  const failedTxids: string[] = [];

  // Build a map of SavedGraphNode by txid for quick lookup
  const savedByTxid = new Map<string, SavedGraphNode>();
  for (const n of saved.nodes) {
    savedByTxid.set(n.txid, n);
  }

  // Fetch all txids with bounded concurrency
  const nodes = new Map<string, GraphNode>();
  const queue = [...saved.nodes];

  while (queue.length > 0) {
    if (signal?.aborted) break;

    const batch = queue.splice(0, CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (sn) => {
        if (signal?.aborted) throw new Error("aborted");
        const tx = await fetcher.getTransaction(sn.txid);
        return { sn, tx };
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        const { sn, tx } = result.value;
        const node: GraphNode = {
          txid: sn.txid,
          tx,
          depth: sn.depth,
          parentEdge: sn.parentEdge ? { ...sn.parentEdge } : undefined,
          childEdge: sn.childEdge ? { ...sn.childEdge } : undefined,
        };
        nodes.set(sn.txid, node);
      } else {
        failedTxids.push(batch[results.indexOf(result)]?.txid ?? "unknown");
      }
      loaded++;
      onProgress?.(Math.min(loaded, total), total);
    }
  }

  // Clean up edges that reference missing nodes
  if (failedTxids.length > 0) {
    for (const [, node] of nodes) {
      if (node.parentEdge && !nodes.has(node.parentEdge.fromTxid)) {
        node.parentEdge = undefined;
      }
      if (node.childEdge && !nodes.has(node.childEdge.toTxid)) {
        node.childEdge = undefined;
      }
    }
  }

  const rootTxid = nodes.has(saved.rootTxid) ? saved.rootTxid : (nodes.keys().next().value ?? "");
  const rootTxids = new Set(
    saved.rootTxids.filter((t) => nodes.has(t)),
  );
  if (rootTxids.size === 0 && rootTxid) rootTxids.add(rootTxid);

  return { nodes, rootTxid, rootTxids, failedTxids };
}
