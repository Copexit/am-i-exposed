import type { GraphNode } from "./graph-reducer";

/**
 * Txids within `hops` links of any seed, over the in-graph funding links
 * (a vin of one node spending another node's output), seeds included.
 */
export function nodesWithinHops(
  nodes: ReadonlyMap<string, GraphNode>,
  seeds: Iterable<string>,
  hops: number,
): Set<string> {
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = adj.get(a);
    if (list) list.push(b); else adj.set(a, [b]);
  };
  for (const node of nodes.values()) {
    for (const v of node.tx.vin) {
      if (v.is_coinbase || v.txid === node.txid || !nodes.has(v.txid)) continue;
      link(node.txid, v.txid);
      link(v.txid, node.txid);
    }
  }
  const seen = new Set([...seeds].filter((s) => nodes.has(s)));
  let frontier = [...seen];
  for (let d = 0; d < hops && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const txid of frontier) {
      for (const n of adj.get(txid) ?? []) {
        if (!seen.has(n)) { seen.add(n); next.push(n); }
      }
    }
    frontier = next;
  }
  return seen;
}

/**
 * Isolate seeds after the graph changed: seeds that left the graph drop out and
 * nodes added since `prevKeys` join (an expand inside an isolate shows up).
 * Null when no seed is left (the isolate ends); the same set when nothing changed.
 */
export function nextIsolateSeeds(
  seeds: ReadonlySet<string>,
  prevKeys: ReadonlySet<string>,
  nodes: ReadonlyMap<string, unknown>,
): ReadonlySet<string> | null {
  const kept = [...seeds].filter((txid) => nodes.has(txid));
  if (kept.length === 0) return null;
  const added = [...nodes.keys()].filter((txid) => !prevKeys.has(txid) && !seeds.has(txid));
  if (added.length === 0 && kept.length === seeds.size) return seeds;
  return new Set([...kept, ...added]);
}
