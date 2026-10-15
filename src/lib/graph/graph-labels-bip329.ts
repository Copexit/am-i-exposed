/**
 * Graph explorer labels as BIP329 records. A node label is a `tx` record; an
 * edge label (key "from->to") is an `output` record for every vout the edge
 * spends, so all outputs of a bundled edge share it. Pure, nothing is logged.
 */
import { cut, userPart, type Bip329Record } from "@/lib/wallet/bip329";

export interface GraphEdgeRef { fromTxid: string; toTxid: string; outputIndices?: number[] }
interface TxNode { txid: string; tx: { vin: ReadonlyArray<{ txid: string; vout: number; is_coinbase?: boolean }> } }

/** Every on-chain link between two graph nodes (the layout's rule: one edge per from/to pair, with the vouts it spends). */
export function edgesFromNodes(nodes: ReadonlyMap<string, TxNode>): GraphEdgeRef[] {
  const byKey = new Map<string, GraphEdgeRef>();
  for (const node of nodes.values()) {
    for (const v of node.tx.vin) {
      if (v.is_coinbase || !nodes.has(v.txid)) continue;
      const key = `${v.txid}->${node.txid}`;
      const e = byKey.get(key) ?? { fromTxid: v.txid, toTxid: node.txid, outputIndices: [] };
      e.outputIndices!.push(v.vout);
      byKey.set(key, e);
    }
  }
  return [...byKey.values()];
}

export function graphLabelsToBip329(
  nodeLabels: ReadonlyMap<string, string>,
  edgeLabels: ReadonlyMap<string, string>,
  edges: ReadonlyArray<GraphEdgeRef>,
): Bip329Record[] {
  const out: Bip329Record[] = [];
  for (const [txid, label] of nodeLabels) if (label) out.push({ type: "tx", ref: txid, label: cut(label) });
  for (const e of edges) {
    const label = edgeLabels.get(`${e.fromTxid}->${e.toTxid}`);
    if (!label || !e.outputIndices) continue;
    for (const vout of e.outputIndices) out.push({ type: "output", ref: `${e.fromTxid}:${vout}`, label: cut(label) });
  }
  return out;
}

export function bip329ToGraphLabels(
  records: Bip329Record[],
  nodeTxids: ReadonlySet<string>,
  edges: ReadonlyArray<GraphEdgeRef>,
): { nodeLabels: Map<string, string>; edgeLabels: Map<string, string>; unmatched: number } {
  const nodeLabels = new Map<string, string>();
  const perEdge = new Map<string, string[]>();
  let unmatched = 0;
  for (const r of records) {
    const label = userPart(r.label ?? "");
    if (label && r.type === "tx" && nodeTxids.has(r.ref)) { nodeLabels.set(r.ref, label); continue; }
    if (label && r.type === "output") {
      const [txid, vout] = r.ref.split(":");
      const e = edges.find((x) => x.fromTxid === txid && x.outputIndices?.includes(Number(vout)));
      if (e) {
        const key = `${e.fromTxid}->${e.toTxid}`;
        const list = perEdge.get(key) ?? [];
        if (!list.includes(label)) list.push(label);
        perEdge.set(key, list);
        continue;
      }
    }
    unmatched++;
  }
  const edgeLabels = new Map<string, string>();
  for (const [key, list] of perEdge) edgeLabels.set(key, cut(list.join(" / ")));
  return { nodeLabels, edgeLabels, unmatched };
}

/** Whether a record maps onto this graph (a node, or an output an edge spends). */
export function recordFitsGraph(r: Bip329Record, nodeTxids: ReadonlySet<string>, edges: ReadonlyArray<GraphEdgeRef>): boolean {
  return bip329ToGraphLabels([r], nodeTxids, edges).unmatched === 0;
}
