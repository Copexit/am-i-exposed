import { SVG_COLORS } from "../shared/svgConstants";
import { calcVsize } from "@/lib/format";
import { matchEntitySync } from "@/lib/analysis/entity-filter/entity-match";
import { analyzeCoinJoin, isCoinJoinFinding } from "@/lib/analysis/heuristics/coinjoin";
import { analyzeMultisigDetection } from "@/lib/analysis/heuristics/multisig-detection";
import { NODE_W, NODE_H, COL_GAP, ROW_GAP, MARGIN, ENTITY_CATEGORY_COLORS, HEAT_TIERS, HEAT_FLOOR_COLOR, EXPANDED_NODE_W } from "./constants";
import { calcExpandedHeight } from "./portLayout";
import type { GraphNode, LayoutNode, LayoutEdge, NodeFilter, ViewTransform } from "./types";
import type { MempoolTransaction } from "@/lib/api/types";
import type { EntityMatch } from "@/lib/analysis/entity-filter/types";
import type { FindingId } from "@/lib/analysis/finding-metadata";
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

/** Map heuristic finding IDs to entity-like labels for graph visualization. */
const HEURISTIC_ENTITY_MAP: Partial<Record<FindingId, { entityName: string; category: EntityMatch["category"] }>> = {
  "h17-hodlhodl": { entityName: "HodlHodl", category: "p2p" },
  "h17-bisq": { entityName: "Bisq", category: "p2p" },
  "h17-bisq-deposit": { entityName: "Bisq", category: "p2p" },
};

/** Derive an entity match from heuristic findings (e.g. multisig detection). */
function entityFromHeuristics(tx: MempoolTransaction): EntityMatch | null {
  const { findings } = analyzeMultisigDetection(tx);
  for (const f of findings) {
    const mapped = HEURISTIC_ENTITY_MAP[f.id];
    if (mapped) {
      return {
        address: tx.txid,
        entityName: mapped.entityName,
        category: mapped.category,
        ofac: false,
        confidence: "high",
      };
    }
  }
  return null;
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

/** Per-txid cache for expensive CoinJoin + entity analysis (cleared when node map identity changes). */
let _layoutCacheNodes: Map<string, GraphNode> | null = null;
const _layoutCache = new Map<string, { isCJ: boolean; coinJoinType: string | undefined; entityMatch: EntityMatch | null }>();

function getCachedAnalysis(graphNodes: Map<string, GraphNode>, tx: MempoolTransaction, txid: string) {
  // Invalidate cache when the underlying map reference changes (new nodes added/removed)
  if (_layoutCacheNodes !== graphNodes) {
    _layoutCacheNodes = graphNodes;
    _layoutCache.clear();
  }
  let cached = _layoutCache.get(txid);
  if (!cached) {
    const cjResult = analyzeCoinJoin(tx);
    const isCJ = cjResult.findings.some(isCoinJoinFinding);
    cached = {
      isCJ,
      coinJoinType: isCJ ? getCoinJoinType(cjResult.findings) : undefined,
      entityMatch: getBestEntityMatch(tx) ?? entityFromHeuristics(tx),
    };
    _layoutCache.set(txid, cached);
  }
  return cached;
}

/** Lay out graph nodes in depth-based columns, build edges from parent/child relationships. */
export function layoutGraph(
  graphNodes: Map<string, GraphNode>,
  rootTxid: string,
  filter: NodeFilter,
  rootTxids?: Set<string>,
  expandedNodeTxid?: string | null,
  /** Reserve left padding so backward expansions don't shift nodes (fullscreen pan/zoom mode). */
  reserveBackwardSpace?: boolean,
  /** User-defined position overrides (from node dragging). */
  positionOverrides?: Map<string, { x: number; y: number }>,
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

  // Determine which depth column contains the expanded node
  const expandedNode = expandedNodeTxid ? graphNodes.get(expandedNodeTxid) : undefined;
  const expandedDepth = expandedNode?.depth;

  // Calculate per-column widths (expanded column is wider)
  const colWidths = new Map<number, number>();
  for (const depth of depths) {
    const hasExpanded = depth === expandedDepth;
    colWidths.set(depth, hasExpanded ? EXPANDED_NODE_W : NODE_W);
  }

  // Calculate cumulative x positions.
  // Reserve space to the left of depth 0 so backward expansions don't shift
  // existing nodes. In pan/zoom mode, reserve ~half viewport width so the root
  // can be centered and backward expansions fill the left side naturally.
  // As negative-depth columns are added, the reserved space shrinks to match.
  const viewportHalf = typeof window !== "undefined" ? Math.round(window.innerWidth / 2) : 700;
  const existingBackwardWidth = depths.filter((d) => d < 0).length * (NODE_W + COL_GAP);
  const backwardPadding = reserveBackwardSpace
    ? Math.max(0, viewportHalf - existingBackwardWidth)
    : 0;

  const colX = new Map<number, number>();
  let cumX = MARGIN.left + backwardPadding;
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
      const { isCJ, coinJoinType, entityMatch } = getCachedAnalysis(graphNodes, node.tx, node.txid);
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

  // Apply user-defined position overrides (node dragging)
  if (positionOverrides) {
    for (const [txid, pos] of positionOverrides) {
      const existing = nodePositions.get(txid);
      if (!existing) continue;
      existing.x = pos.x;
      existing.y = pos.y;
      // Also update the layoutNode
      const ln = layoutNodes.find((n) => n.txid === txid);
      if (ln) { ln.x = pos.x; ln.y = pos.y; }
    }
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

  // Calculate total dimensions (extra padding for pan/zoom drag surface)
  const extraPadding = reserveBackwardSpace ? 400 : 0;
  const maxX = Math.max(...layoutNodes.map((n) => n.x + n.width), 0) + extraPadding;
  const maxY = Math.max(...layoutNodes.map((n) => n.y + n.height), 0) + extraPadding;

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

// ─── Viewport fitting ───────────────────────────────────────────

/** Minimum horizontal margin on each side for small screens. */
const MIN_MARGIN_X = 16;
/** Cap on the window-based horizontal padding fallback (px). */
const MAX_FALLBACK_PAD_X = 48;
/** Window-based horizontal padding fallback, as a fraction of the window width. */
const FALLBACK_PAD_X_RATIO = 0.08;
/** Fallback vertical padding when no container ref is available. */
const FALLBACK_PAD_Y = 160;
/** Fit-to-view never zooms in past this scale (small graphs stay readable, not huge). */
const MAX_FIT_SCALE = 1.5;

type ContainerDims = { width: number; height: number };

/**
 * Compute the usable viewport dimensions.
 * Uses measured container dims from ParentSize (via onLayoutComplete) when available.
 */
export function getViewportDims(dims?: ContainerDims) {
  if (dims && dims.width > 0 && dims.height > 0) {
    return { cw: dims.width, ch: dims.height };
  }
  // Last resort: use window dimensions with padding
  const padX = Math.max(MIN_MARGIN_X * 2, Math.min(MAX_FALLBACK_PAD_X, window.innerWidth * FALLBACK_PAD_X_RATIO));
  return { cw: window.innerWidth - padX, ch: window.innerHeight - FALLBACK_PAD_Y };
}

/** Compute a ViewTransform that centers the root nodes within the viewport. */
export function computeRootCenterView(roots: LayoutNode[], dims?: ContainerDims): ViewTransform {
  const { cw, ch } = getViewportDims(dims);
  if (roots.length === 0) return { x: 0, y: 0, scale: 1 };
  const avgX = roots.reduce((s, n) => s + n.x + n.width / 2, 0) / roots.length;
  const avgY = roots.reduce((s, n) => s + n.y + n.height / 2, 0) / roots.length;
  return { x: cw / 2 - avgX, y: ch / 2 - avgY, scale: 1 };
}

/** Compute a ViewTransform that fits all layout nodes within the viewport. */
export function computeFitView(ln: LayoutNode[], dims?: ContainerDims): ViewTransform | null {
  if (ln.length === 0) return null;
  const { cw, ch } = getViewportDims(dims);
  const minX = Math.min(...ln.map((n) => n.x));
  const minY = Math.min(...ln.map((n) => n.y));
  const maxX = Math.max(...ln.map((n) => n.x + n.width));
  const maxY = Math.max(...ln.map((n) => n.y + n.height));
  const nodesW = maxX - minX;
  const nodesH = maxY - minY;
  const s = Math.min(cw / nodesW, ch / nodesH, MAX_FIT_SCALE);
  const rawX = (cw - nodesW * s) / 2 - minX * s;
  // Ensure nodes don't clip the left edge on small screens
  const x = Math.max(rawX, MIN_MARGIN_X - minX * s);
  return { x, y: (ch - nodesH * s) / 2 - minY * s, scale: s };
}

/**
 * Initial view for the compact inline canvas: fit when that stays readable
 * (scale >= minScale, never zoom in), otherwise keep minScale and center the root.
 */
export function computeCompactView(ln: LayoutNode[], dims?: ContainerDims, minScale = 0.75): ViewTransform | null {
  if (ln.length === 0) return null;
  const { cw, ch } = getViewportDims(dims);
  const minX = Math.min(...ln.map((n) => n.x));
  const minY = Math.min(...ln.map((n) => n.y));
  const nodesW = Math.max(...ln.map((n) => n.x + n.width)) - minX;
  const nodesH = Math.max(...ln.map((n) => n.y + n.height)) - minY;
  const s = Math.max(minScale, Math.min(1, cw / nodesW, ch / nodesH));
  const roots = ln.filter((n) => n.isRoot);
  const focus = roots.length > 0 ? roots : ln;
  const cx = focus.reduce((a, n) => a + n.x + n.width / 2, 0) / focus.length;
  const cy = focus.reduce((a, n) => a + n.y + n.height / 2, 0) / focus.length;
  const x = nodesW * s <= cw ? (cw - nodesW * s) / 2 - minX * s : cw / 2 - cx * s;
  const y = nodesH * s <= ch ? (ch - nodesH * s) / 2 - minY * s : ch / 2 - cy * s;
  return { x, y, scale: s };
}

// ─── Seeding positions for newly expanded nodes ─────────────────

/** Horizontal offset of a backward-expanded node from its trigger node. */
export const SEED_BACKWARD_DX = 280;
/** Gap between a trigger node's right edge and a forward-expanded node. */
export const SEED_FORWARD_GAP = COL_GAP;
/** Vertical slot one collapsed node occupies. */
const SEED_SLOT_H = NODE_H + ROW_GAP;
/** Only nodes this close horizontally count as occupying the target column. */
const SEED_X_TOLERANCE = 300;
/** Give up nudging down after this many slots. */
const SEED_MAX_ATTEMPTS = 50;

/**
 * Find a y position near targetY that doesn't overlap nodes in nearby columns,
 * nudging down one slot at a time.
 */
export function findFreeY(
  targetX: number,
  targetY: number,
  positionSources: Iterable<[string, { x: number; y: number }]>[],
  excludeTxid?: string,
): number {
  const occupied: number[] = [];
  for (const source of positionSources) {
    for (const [txid, pos] of source) {
      if (txid !== excludeTxid && Math.abs(pos.x - targetX) < SEED_X_TOLERANCE) occupied.push(pos.y);
    }
  }
  let y = targetY;
  for (let attempts = 0; attempts < SEED_MAX_ATTEMPTS; attempts++) {
    if (!occupied.some((oy) => Math.abs(oy - y) < SEED_SLOT_H)) return y;
    y += SEED_SLOT_H;
  }
  return y;
}
