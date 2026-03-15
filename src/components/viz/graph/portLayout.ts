import { PORT_H, PORT_GAP, EXPANDED_HEADER_H, EXPANDED_PAD_V, MAX_VISIBLE_PORTS } from "./constants";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { GraphNode, PortLayout, PortPositionMap } from "./types";

/**
 * Pre-built spending index: maps "${txid}:${vout}" to the spender node info.
 * Avoids O(n*m) scans when checking if an output is consumed by any node.
 */
export type SpendingIndex = Map<string, { spenderTxid: string; inputIdx: number }>;

/** Cached spending index - invalidated when graph nodes identity changes. */
let _spendingIndexNodes: Map<string, GraphNode> | null = null;
let _spendingIndex: SpendingIndex = new Map();

/** Build (or return cached) spending index from graph nodes. */
export function getSpendingIndex(graphNodes: Map<string, GraphNode>): SpendingIndex {
  if (_spendingIndexNodes === graphNodes) return _spendingIndex;
  _spendingIndexNodes = graphNodes;
  _spendingIndex = new Map();
  for (const [txid, node] of graphNodes) {
    for (let i = 0; i < node.tx.vin.length; i++) {
      const vin = node.tx.vin[i];
      if (vin.is_coinbase) continue;
      const key = `${vin.txid}:${vin.vout}`;
      _spendingIndex.set(key, { spenderTxid: txid, inputIdx: i });
    }
  }
  return _spendingIndex;
}

/** Calculate the height of an expanded node based on its port count. */
export function calcExpandedHeight(tx: MempoolTransaction): number {
  const portCount = Math.max(tx.vin.length, tx.vout.length);
  const clamped = Math.min(portCount, MAX_VISIBLE_PORTS);
  return EXPANDED_PAD_V * 2 + EXPANDED_HEADER_H + clamped * PORT_H + Math.max(0, clamped - 1) * PORT_GAP;
}

/** Get the y-center of a port at the given index within an expanded node. */
export function getPortY(
  nodeY: number,
  portIndex: number,
  portCount: number,
  nodeHeight: number,
): number {
  const clamped = Math.min(portCount, MAX_VISIBLE_PORTS);
  const totalPortsH = clamped * PORT_H + Math.max(0, clamped - 1) * PORT_GAP;
  const startY = nodeY + EXPANDED_HEADER_H + EXPANDED_PAD_V + (nodeHeight - EXPANDED_HEADER_H - EXPANDED_PAD_V * 2 - totalPortsH) / 2;
  return startY + portIndex * (PORT_H + PORT_GAP) + PORT_H / 2;
}

/** Build input port layouts for an expanded node. */
export function buildInputPorts(
  tx: MempoolTransaction,
  nodeY: number,
  nodeHeight: number,
  graphNodes: Map<string, GraphNode>,
): PortLayout[] {
  const ports: PortLayout[] = [];
  const count = Math.min(tx.vin.length, MAX_VISIBLE_PORTS);

  for (let i = 0; i < count; i++) {
    const vin = tx.vin[i];
    const parentTxid = vin.is_coinbase ? undefined : vin.txid;
    const isInGraph = parentTxid ? graphNodes.has(parentTxid) : false;

    ports.push({
      index: i,
      address: vin.is_coinbase ? "coinbase" : (vin.prevout?.scriptpubkey_address ?? "unknown"),
      value: vin.prevout?.value ?? 0,
      scriptType: vin.prevout?.scriptpubkey_type ?? "unknown",
      y: getPortY(nodeY, i, tx.vin.length, nodeHeight),
      parentTxid,
      isExpandable: !vin.is_coinbase && !isInGraph,
      isExpanded: isInGraph,
    });
  }

  return ports;
}

/** Build output port layouts for an expanded node. */
export function buildOutputPorts(
  tx: MempoolTransaction,
  nodeY: number,
  nodeHeight: number,
  graphNodes: Map<string, GraphNode>,
  outspends?: MempoolOutspend[],
): PortLayout[] {
  const ports: PortLayout[] = [];
  const count = Math.min(tx.vout.length, MAX_VISIBLE_PORTS);

  const spendingIdx = getSpendingIndex(graphNodes);

  for (let i = 0; i < count; i++) {
    const vout = tx.vout[i];
    const os = outspends?.[i];
    const spentByTxid = os?.spent ? os.txid : undefined;
    const isInGraph = spentByTxid ? graphNodes.has(spentByTxid) : false;
    // O(1) lookup instead of O(n*m) scan
    const isConsumed = isInGraph || spendingIdx.has(`${tx.txid}:${i}`);

    ports.push({
      index: i,
      address: vout.scriptpubkey_address ?? (vout.scriptpubkey_type === "op_return" ? "OP_RETURN" : "unknown"),
      value: vout.value,
      scriptType: vout.scriptpubkey_type,
      y: getPortY(nodeY, i, tx.vout.length, nodeHeight),
      spent: os?.spent ?? null,
      spentByTxid,
      isExpandable: vout.scriptpubkey_type !== "op_return" && vout.value > 0 && !isConsumed,
      isExpanded: isConsumed,
    });
  }

  return ports;
}

/** Build a port position map for all expanded nodes in the graph (for edge routing). */
export function buildPortPositionMap(
  expandedNodeTxid: string | null,
  graphNodes: Map<string, GraphNode>,
  nodePositions: Map<string, { x: number; y: number; w: number; h: number }>,
): PortPositionMap {
  const map: PortPositionMap = new Map();
  if (!expandedNodeTxid) return map;

  const node = graphNodes.get(expandedNodeTxid);
  const pos = nodePositions.get(expandedNodeTxid);
  if (!node || !pos) return map;

  const tx = node.tx;

  // Input ports (left side of node)
  const inputCount = Math.min(tx.vin.length, MAX_VISIBLE_PORTS);
  for (let i = 0; i < inputCount; i++) {
    const y = getPortY(pos.y, i, tx.vin.length, pos.h);
    map.set(`${expandedNodeTxid}:input:${i}`, { x: pos.x, y });
  }

  // Output ports (right side of node)
  const outputCount = Math.min(tx.vout.length, MAX_VISIBLE_PORTS);
  for (let i = 0; i < outputCount; i++) {
    const y = getPortY(pos.y, i, tx.vout.length, pos.h);
    map.set(`${expandedNodeTxid}:output:${i}`, { x: pos.x + pos.w, y });
  }

  return map;
}
