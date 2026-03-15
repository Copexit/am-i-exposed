import { SVG_COLORS } from "../shared/svgConstants";
import { calcVsize } from "@/lib/format";
import { matchEntitySync } from "@/lib/analysis/entity-filter/entity-match";
import { analyzeCoinJoin, isCoinJoinFinding } from "@/lib/analysis/heuristics/coinjoin";
import { NODE_W, NODE_H, COL_GAP, ROW_GAP, MARGIN, ENTITY_CATEGORY_COLORS, HEAT_TIERS, HEAT_FLOOR_COLOR, EXPANDED_NODE_W } from "./constants";
import { calcExpandedHeight } from "./portLayout";
import type { GraphNode, LayoutNode, LayoutEdge, NodeFilter } from "./types";
import type { MempoolTransaction } from "@/lib/api/types";
import type { EntityMatch } from "@/lib/analysis/entity-filter/types";
import type { Finding } from "@/lib/types";

/** Detect CoinJoin type from findings. */
export function getCoinJoinType(findings: Finding[]): string | undefined {
  const cjFinding = findings.find((f) => isCoinJoinFinding(f));
  if (!cjFinding) return undefined;
  if (cjFinding.id === "h4-whirlpool") return "Whirlpool";
  if (cjFinding.id === "h4-joinmarket") return "JoinMarket";
  if (cjFinding.id === "h4-stonewall") return "Stonewall";
  if (cjFinding.id === "h4-simplified-stonewall") return "Stonewall";
  if (cjFinding.id === "h4-coinjoin") {
    // Check if it's WabiSabi by input/output count
    if (cjFinding.title?.toLowerCase().includes("wabisabi") || cjFinding.title?.toLowerCase().includes("wasabi")) {
      return "WabiSabi";
    }
    return "CoinJoin";
  }
  return "CoinJoin";
}

/** Get the best entity match from all tx addresses (inputs + outputs). */
export function getBestEntityMatch(tx: MempoolTransaction): EntityMatch | null {
  let best: EntityMatch | null = null;

  // Check output addresses
  for (const o of tx.vout) {
    if (!o.scriptpubkey_address) continue;
    const m = matchEntitySync(o.scriptpubkey_address);
    if (m && (!best || m.ofac || (m.confidence === "high" && best.confidence !== "high"))) {
      best = m;
    }
  }

  // Check input prevout addresses
  for (const v of tx.vin) {
    if (v.is_coinbase || !v.prevout?.scriptpubkey_address) continue;
    const m = matchEntitySync(v.prevout.scriptpubkey_address);
    if (m && (!best || m.ofac || (m.confidence === "high" && best.confidence !== "high"))) {
      best = m;
    }
  }

  return best;
}

/** Lay out graph nodes in depth-based columns, build edges from parent/child relationships. */
export function layoutGraph(
  graphNodes: Map<string, GraphNode>,
  rootTxid: string,
  filter: NodeFilter,
  rootTxids?: Set<string>,
  expandedNodeTxid?: string | null,
): { layoutNodes: LayoutNode[]; edges: LayoutEdge[]; width: number; height: number; nodePositions: Map<string, { x: number; y: number; w: number; h: number }> } {
  const layoutNodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];

  // Group by depth
  const depthGroups = new Map<number, GraphNode[]>();
  for (const [, node] of graphNodes) {
    const group = depthGroups.get(node.depth) ?? [];
    group.push(node);
    depthGroups.set(node.depth, group);
  }

  const depths = [...depthGroups.keys()].sort((a, b) => a - b);
  const minDepth = depths[0] ?? 0;

  // Determine which depth column contains the expanded node
  const expandedNode = expandedNodeTxid ? graphNodes.get(expandedNodeTxid) : undefined;
  const expandedDepth = expandedNode?.depth;

  // Calculate per-column widths (expanded column is wider)
  const colWidths = new Map<number, number>();
  for (const depth of depths) {
    const hasExpanded = depth === expandedDepth;
    colWidths.set(depth, hasExpanded ? EXPANDED_NODE_W : NODE_W);
  }

  // Calculate cumulative x positions
  const colX = new Map<number, number>();
  let cumX = MARGIN.left;
  for (const depth of depths) {
    colX.set(depth, cumX);
    cumX += colWidths.get(depth)! + COL_GAP;
  }

  // Layout each depth column with variable node heights
  const nodePositions = new Map<string, { x: number; y: number; w: number; h: number }>();

  for (const depth of depths) {
    const group = depthGroups.get(depth)!;
    const x = colX.get(depth)!;
    let yOffset = MARGIN.top;

    group.forEach((node) => {
      const cjResult = analyzeCoinJoin(node.tx);
      const isCJ = cjResult.findings.some(isCoinJoinFinding);
      const coinJoinType = isCJ ? getCoinJoinType(cjResult.findings) : undefined;
      const entityMatch = getBestEntityMatch(node.tx);
      const isRoot = rootTxids ? rootTxids.has(node.txid) : node.txid === rootTxid;

      // Apply filter (never filter root, never filter expanded)
      if (!isRoot && node.txid !== expandedNodeTxid) {
        if (isCJ && !filter.showCoinJoin) return;
        if (entityMatch && !isCJ && !filter.showEntity) return;
        if (!isCJ && !entityMatch && !filter.showStandard) return;
      }

      const isExpanded = node.txid === expandedNodeTxid;
      const nodeW = isExpanded ? EXPANDED_NODE_W : NODE_W;
      const nodeH = isExpanded ? calcExpandedHeight(node.tx) : NODE_H;

      nodePositions.set(node.txid, { x, y: yOffset, w: nodeW, h: nodeH });

      const vsize = calcVsize(node.tx.weight);
      const feeRate = vsize > 0 ? (node.tx.fee / vsize).toFixed(1) : "0";

      layoutNodes.push({
        txid: node.txid,
        tx: node.tx,
        x,
        y: yOffset,
        width: nodeW,
        height: nodeH,
        depth: node.depth,
        isRoot,
        isCoinJoin: isCJ,
        coinJoinType,
        entityLabel: entityMatch?.entityName,
        entityCategory: entityMatch?.category,
        entityOfac: entityMatch?.ofac,
        entityConfidence: entityMatch?.confidence,
        inputCount: node.tx.vin.length,
        outputCount: node.tx.vout.length,
        fee: node.tx.fee,
        feeRate,
        confirmed: node.tx.status?.confirmed ?? false,
      });

      yOffset += nodeH + ROW_GAP;
    });
  }

  // Build edges from parent/child relationships
  const edgeSet = new Set<string>();

  for (const [, node] of graphNodes) {
    if (node.parentEdge) {
      const eKey = `${node.parentEdge.fromTxid}->${node.txid}`;
      if (edgeSet.has(eKey)) continue;
      edgeSet.add(eKey);
      const fromPos = nodePositions.get(node.parentEdge.fromTxid);
      const toPos = nodePositions.get(node.txid);
      if (fromPos && toPos) {
        const parentVins = node.tx.vin.filter((v) => v.txid === node.parentEdge!.fromTxid);
        const cc = parentVins.length;
        edges.push({
          fromTxid: node.parentEdge.fromTxid,
          toTxid: node.txid,
          x1: fromPos.x + fromPos.w,
          y1: fromPos.y + fromPos.h / 2,
          x2: toPos.x,
          y2: toPos.y + toPos.h / 2,
          isBackward: false,
          consolidationCount: cc,
          outputIndices: parentVins.map((v) => v.vout),
        });
      }
    }
    if (node.childEdge) {
      const eKey = `${node.txid}->${node.childEdge.toTxid}`;
      if (edgeSet.has(eKey)) continue;
      edgeSet.add(eKey);
      const fromPos = nodePositions.get(node.txid);
      const toPos = nodePositions.get(node.childEdge.toTxid);
      if (fromPos && toPos) {
        const childNode = graphNodes.get(node.childEdge.toTxid);
        const childVins = childNode
          ? childNode.tx.vin.filter((v) => v.txid === node.txid)
          : [];
        const cc = childVins.length || 1;
        edges.push({
          fromTxid: node.txid,
          toTxid: node.childEdge.toTxid,
          x1: fromPos.x + fromPos.w,
          y1: fromPos.y + fromPos.h / 2,
          x2: toPos.x,
          y2: toPos.y + toPos.h / 2,
          isBackward: true,
          consolidationCount: cc,
          outputIndices: childVins.length > 0 ? childVins.map((v) => v.vout) : undefined,
        });
      }
    }
  }

  // Calculate total dimensions
  const maxX = Math.max(...layoutNodes.map((n) => n.x + n.width), 0);
  const maxY = Math.max(...layoutNodes.map((n) => n.y + n.height), 0);

  return {
    layoutNodes,
    edges,
    width: maxX + MARGIN.right,
    height: maxY + MARGIN.bottom,
    nodePositions,
  };
}

/** Get the fill color for a node based on its type or heat map score. */
export function getNodeColor(node: LayoutNode, heatScore?: number): string {
  // Heat map mode: color by score
  if (heatScore !== undefined) {
    for (const tier of HEAT_TIERS) {
      if (heatScore >= tier.min) return tier.color;
    }
    return HEAT_FLOOR_COLOR;
  }
  if (node.isRoot) return SVG_COLORS.bitcoin;
  if (node.isCoinJoin) return SVG_COLORS.good;
  if (node.entityLabel) {
    return ENTITY_CATEGORY_COLORS[node.entityCategory ?? "unknown"];
  }
  return SVG_COLORS.low;
}
