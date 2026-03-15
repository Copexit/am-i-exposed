/**
 * Compute multi-hop deterministic link chains across the transaction graph.
 *
 * A deterministic chain exists when: tx A has a deterministic link from input I
 * to output O, and output O is spent in tx B which also has a deterministic link
 * from that input to one of its outputs. These chain together into certainty-level
 * traces that an analyst can follow with 100% confidence.
 */

import type { GraphNode } from "@/hooks/useGraphExpansion";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";
import { getSpendingIndex } from "./portLayout";

/** A single hop in a deterministic chain. */
export interface DetChainHop {
  fromTxid: string;
  toTxid: string;
  outputIndex: number;  // which output of fromTxid
  inputIndex: number;   // which input of toTxid
}

/** A complete deterministic chain (2+ hops of 100% linkability). */
export interface DetChain {
  hops: DetChainHop[];
  /** Total number of hops in this chain. */
  length: number;
}

/**
 * Find all multi-hop deterministic link chains in the graph.
 *
 * For each node with Boltzmann data, follow deterministic links forward
 * through the graph until the chain breaks (no deterministic link at next hop,
 * or next node has no Boltzmann data, or next node not in graph).
 *
 * Returns chains of length >= 2 (single-hop deterministic links are already
 * shown as "100%" badges on individual edges).
 */
export function computeDeterministicChains(
  nodes: Map<string, GraphNode>,
  boltzmannCache: Map<string, BoltzmannWorkerResult>,
): DetChain[] {
  const chains: DetChain[] = [];
  const visited = new Set<string>(); // avoid duplicate chains
  const spendingIdx = getSpendingIndex(nodes);

  for (const [txid, boltz] of boltzmannCache) {
    if (!boltz.deterministicLinks?.length) continue;
    const node = nodes.get(txid);
    if (!node) continue;

    // For each deterministic link in this tx, try to extend it forward
    for (const [outIdx, _inIdx] of boltz.deterministicLinks) {
      const chainKey = `${txid}:${outIdx}`;
      if (visited.has(chainKey)) continue;

      const hops: DetChainHop[] = [];
      let currentTxid = txid;
      let currentOutIdx = outIdx;

      // Follow the chain forward
      while (true) {
        // O(1) lookup via spending index instead of O(n^2) scan
        const spender = spendingIdx.get(`${currentTxid}:${currentOutIdx}`);
        const childTxid = spender?.spenderTxid ?? null;
        const childInputIdx = spender?.inputIdx ?? -1;

        if (!childTxid || childInputIdx < 0) break;

        hops.push({
          fromTxid: currentTxid,
          toTxid: childTxid,
          outputIndex: currentOutIdx,
          inputIndex: childInputIdx,
        });

        // Mark as visited
        visited.add(`${currentTxid}:${currentOutIdx}`);

        // Check if child tx also has a deterministic link from this input
        const childBoltz = boltzmannCache.get(childTxid);
        if (!childBoltz?.deterministicLinks?.length) break;

        // Find a deterministic link FROM the input that received our output
        const nextLink = childBoltz.deterministicLinks.find(
          ([, inIdx]) => inIdx === childInputIdx,
        );
        if (!nextLink) break;

        // Continue the chain from the deterministic output
        currentTxid = childTxid;
        currentOutIdx = nextLink[0]; // output index of the deterministic link
      }

      // Only keep chains with 2+ hops
      if (hops.length >= 2) {
        chains.push({ hops, length: hops.length });
      }
    }
  }

  return chains;
}

/** Build a set of edge keys that belong to deterministic chains (for rendering). */
export function buildDetChainEdgeSet(chains: DetChain[]): Set<string> {
  const edgeKeys = new Set<string>();
  for (const chain of chains) {
    for (const hop of chain.hops) {
      edgeKeys.add(`e-${hop.fromTxid}-${hop.toTxid}`);
    }
  }
  return edgeKeys;
}
