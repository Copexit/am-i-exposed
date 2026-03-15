"use client";

import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Text } from "@visx/text";
import { ParentSize } from "@visx/responsive";
import { useTranslation } from "react-i18next";
import { SVG_COLORS, GRADE_HEX_SVG } from "./shared/svgConstants";
import { probColor } from "./shared/linkabilityColors";
import { ChartDefs } from "./shared/ChartDefs";
import { ChartTooltip, useChartTooltip } from "./shared/ChartTooltip";
import { formatSats, calcVsize } from "@/lib/format";
import { truncateId } from "@/lib/constants";
import { useFullscreen } from "@/hooks/useFullscreen";
import { matchEntitySync } from "@/lib/analysis/entity-filter/entity-match";
import { analyzeCoinJoin, isCoinJoinFinding } from "@/lib/analysis/heuristics/coinjoin";
import { analyzeTransactionSync } from "@/lib/analysis/analyze-sync";
import { GraphNodeAnalysis } from "@/components/GraphNodeAnalysis";
import type { GraphNode } from "@/hooks/useGraphExpansion";
import type { MempoolTransaction } from "@/lib/api/types";
import type { Finding, ScoringResult } from "@/lib/types";
import type { EntityMatch } from "@/lib/analysis/entity-filter/types";
import type { EntityCategory } from "@/lib/analysis/entities";

/**
 * OXT-style interactive graph explorer.
 *
 * Renders an expandable transaction DAG where each node represents a transaction.
 * Users can click inputs (left side) to expand backward or outputs (right side)
 * to expand forward. Nodes are colored by privacy grade and entity attribution.
 *
 * Features: fullscreen mode, entity category colors, OFAC warnings, hover glow,
 * edge highlighting, click-to-analyze panel, minimap, node filtering, keyboard nav,
 * path tracing, risk heat map, SVG export.
 */

interface GraphExplorerProps {
  nodes: Map<string, GraphNode>;
  rootTxid: string;
  /** Multi-root highlight set (wallet UTXO graph). */
  rootTxids?: Set<string>;
  /** Txid -> vout indices for UTXO badges on root nodes. */
  walletUtxos?: Map<string, Set<number>>;
  findings?: Finding[];
  loading: Set<string>;
  errors: Map<string, string>;
  nodeCount: number;
  maxNodes: number;
  canUndo: boolean;
  onExpandInput: (txid: string, inputIndex: number) => void;
  onExpandOutput: (txid: string, outputIndex: number) => void;
  onCollapse: (txid: string) => void;
  onUndo: () => void;
  onReset: () => void;
  onTxClick?: (txid: string) => void;
  /** Boltzmann result for the root transaction (linkability edge coloring). */
  rootBoltzmannResult?: import("@/hooks/useBoltzmann").BoltzmannWorkerResult | null;
}

interface LayoutNode {
  txid: string;
  tx: MempoolTransaction;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  isRoot: boolean;
  isCoinJoin: boolean;
  coinJoinType?: string;
  entityLabel?: string;
  entityCategory?: EntityCategory;
  entityOfac?: boolean;
  entityConfidence?: "high" | "medium";
  inputCount: number;
  outputCount: number;
  fee: number;
  feeRate: string;
  confirmed: boolean;
}

interface LayoutEdge {
  fromTxid: string;
  toTxid: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** True when this edge was created by a backward expansion (new node at lower depth). */
  isBackward: boolean;
  /** Number of outputs from `fromTxid` consumed by `toTxid`. >= 2 means consolidation. */
  consolidationCount: number;
  /** Which output indices of `fromTxid` are consumed by `toTxid`. */
  outputIndices?: number[];
}

interface TooltipData {
  txid: string;
  inputCount: number;
  outputCount: number;
  totalValue: number;
  isCoinJoin: boolean;
  coinJoinType?: string;
  entityLabel?: string;
  entityCategory?: EntityCategory;
  entityOfac?: boolean;
  entityConfidence?: "high" | "medium";
  depth: number;
  fee: number;
  feeRate: string;
  confirmed: boolean;
  /** Linkability probability for edge hover tooltip. */
  linkProb?: number;
}

type NodeFilter = {
  showCoinJoin: boolean;
  showEntity: boolean;
  showStandard: boolean;
};

const NODE_W = 180;
const NODE_H = 56;
const COL_GAP = 100;
const ROW_GAP = 24;
const MARGIN = { top: 50, right: 40, bottom: 20, left: 40 };
/** Horizontal/vertical scroll margin (px) before auto-scrolling to focused node. */
const SCROLL_MARGIN_X = 100;
const SCROLL_MARGIN_Y = 50;

/** Category-specific colors for entity nodes. */
const ENTITY_CATEGORY_COLORS: Record<EntityCategory | "unknown", string> = {
  exchange: "#06b6d4",   // teal (distinct from standard-tx blue and root-tx orange)
  darknet: SVG_COLORS.critical,
  scam: SVG_COLORS.critical,
  mixer: SVG_COLORS.good,
  gambling: SVG_COLORS.medium,
  mining: "#9ca3af",     // gray
  payment: "#a78bfa",    // purple
  p2p: SVG_COLORS.high,
  unknown: SVG_COLORS.high,
};

/** Detect CoinJoin type from findings. */
function getCoinJoinType(findings: Finding[]): string | undefined {
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
function getBestEntityMatch(tx: MempoolTransaction): EntityMatch | null {
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

function layoutGraph(
  graphNodes: Map<string, GraphNode>,
  rootTxid: string,
  filter: NodeFilter,
  rootTxids?: Set<string>,
): { layoutNodes: LayoutNode[]; edges: LayoutEdge[]; width: number; height: number } {
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

  // Layout each depth column
  const nodePositions = new Map<string, { x: number; y: number }>();

  for (const depth of depths) {
    const group = depthGroups.get(depth)!;
    const col = depth - minDepth;
    const x = MARGIN.left + col * (NODE_W + COL_GAP);
    const startY = MARGIN.top;
    let visibleIdx = 0;

    group.forEach((node) => {
      const cjResult = analyzeCoinJoin(node.tx);
      const isCJ = cjResult.findings.some(isCoinJoinFinding);
      const coinJoinType = isCJ ? getCoinJoinType(cjResult.findings) : undefined;
      const entityMatch = getBestEntityMatch(node.tx);
      const isRoot = rootTxids ? rootTxids.has(node.txid) : node.txid === rootTxid;

      // Apply filter (never filter root)
      if (!isRoot) {
        if (isCJ && !filter.showCoinJoin) return;
        if (entityMatch && !isCJ && !filter.showEntity) return;
        if (!isCJ && !entityMatch && !filter.showStandard) return;
      }

      const y = startY + visibleIdx * (NODE_H + ROW_GAP);
      visibleIdx++;
      nodePositions.set(node.txid, { x, y });

      const vsize = calcVsize(node.tx.weight);
      const feeRate = vsize > 0 ? (node.tx.fee / vsize).toFixed(1) : "0";

      layoutNodes.push({
        txid: node.txid,
        tx: node.tx,
        x,
        y,
        width: NODE_W,
        height: NODE_H,
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
    });
  }

  // Build edges from parent/child relationships
  // Track edges to avoid duplicates (both parentEdge and childEdge can create the same pair)
  const edgeSet = new Set<string>();

  for (const [, node] of graphNodes) {
    if (node.parentEdge) {
      const eKey = `${node.parentEdge.fromTxid}->${node.txid}`;
      if (edgeSet.has(eKey)) continue;
      edgeSet.add(eKey);
      const fromPos = nodePositions.get(node.parentEdge.fromTxid);
      const toPos = nodePositions.get(node.txid);
      if (fromPos && toPos) {
        // Count how many inputs of this child come from the parent tx
        const parentVins = node.tx.vin.filter((v) => v.txid === node.parentEdge!.fromTxid);
        const cc = parentVins.length;
        edges.push({
          fromTxid: node.parentEdge.fromTxid,
          toTxid: node.txid,
          x1: fromPos.x + NODE_W,
          y1: fromPos.y + NODE_H / 2,
          x2: toPos.x,
          y2: toPos.y + NODE_H / 2,
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
        // Count how many inputs of the child come from this parent tx
        const childNode = graphNodes.get(node.childEdge.toTxid);
        const childVins = childNode
          ? childNode.tx.vin.filter((v) => v.txid === node.txid)
          : [];
        const cc = childVins.length || 1;
        edges.push({
          fromTxid: node.txid,
          toTxid: node.childEdge.toTxid,
          x1: fromPos.x + NODE_W,
          y1: fromPos.y + NODE_H / 2,
          x2: toPos.x,
          y2: toPos.y + NODE_H / 2,
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
  };
}

/** Heat map score thresholds and corresponding colors. */
const HEAT_TIERS: readonly { min: number; color: string }[] = [
  { min: 90, color: SVG_COLORS.good },
  { min: 75, color: "#60a5fa" },   // blue-400
  { min: 50, color: SVG_COLORS.medium },
  { min: 25, color: SVG_COLORS.high },
];
const HEAT_FLOOR_COLOR = SVG_COLORS.critical;

function getNodeColor(node: LayoutNode, heatScore?: number): string {
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

// ─── View Transform (fullscreen pan/zoom) ────────────────────

interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

/** Compute the max linkability probability across all output indices for an edge. */
function getEdgeMaxProb(
  mat: number[][],
  outputIndices: number[],
): number {
  let maxProb = 0;
  for (const outIdx of outputIndices) {
    if (outIdx < mat.length) {
      const row = mat[outIdx];
      for (let i = 0; i < row.length; i++) {
        if (row[i] > maxProb) maxProb = row[i];
      }
    }
  }
  return maxProb;
}

/** Build a cubic bezier SVG path for an edge. */
function edgePath(edge: LayoutEdge): string {
  const midX = (edge.x1 + edge.x2) / 2;
  return edge.isBackward
    ? `M${edge.x2},${edge.y2} C${midX},${edge.y2} ${midX},${edge.y1} ${edge.x1},${edge.y1}`
    : `M${edge.x1},${edge.y1} C${midX},${edge.y1} ${midX},${edge.y2} ${edge.x2},${edge.y2}`;
}

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;

function computeFitTransform(
  graphW: number, graphH: number, containerW: number, containerH: number,
): ViewTransform {
  if (graphW <= 0 || graphH <= 0) return { x: 0, y: 0, scale: 1 };
  const s = Math.min(containerW / graphW, containerH / graphH, 1.5);
  return { x: (containerW - graphW * s) / 2, y: (containerH - graphH * s) / 2, scale: s };
}

// ─── Minimap ───────────────────────────────────────────────────

interface MinimapProps {
  layoutNodes: LayoutNode[];
  edges: LayoutEdge[];
  graphWidth: number;
  graphHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  scrollLeft: number;
  scrollTop: number;
  onMinimapClick: (x: number, y: number) => void;
  heatMap: Map<string, ScoringResult>;
  heatMapActive: boolean;
}

const MINIMAP_W = 160;
const MINIMAP_H = 100;

function Minimap({
  layoutNodes,
  edges,
  graphWidth,
  graphHeight,
  viewportWidth,
  viewportHeight,
  scrollLeft,
  scrollTop,
  onMinimapClick,
  heatMap,
  heatMapActive,
}: MinimapProps) {
  const mmSvgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState(false);

  const scale = useMemo(() => {
    const sX = MINIMAP_W / Math.max(graphWidth, 1);
    const sY = MINIMAP_H / Math.max(graphHeight, 1);
    return Math.min(sX, sY, 1);
  }, [graphWidth, graphHeight]);

  const getGraphPos = useCallback((clientX: number, clientY: number) => {
    const r = mmSvgRef.current?.getBoundingClientRect();
    if (!r) return null;
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
  }, [scale]);

  // Document-level drag handlers for smooth minimap dragging
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const pos = getGraphPos(e.clientX, e.clientY);
      if (pos) onMinimapClick(pos.x, pos.y);
    };
    const onUp = () => setDragging(false);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, [dragging, getGraphPos, onMinimapClick]);

  if (layoutNodes.length <= 1) return null;

  // Clamp viewport rect to minimap bounds so it stays visible
  const rawVpX = scrollLeft * scale;
  const rawVpY = scrollTop * scale;
  const rawVpW = Math.min(viewportWidth * scale, MINIMAP_W);
  const rawVpH = Math.min(viewportHeight * scale, MINIMAP_H);
  const vpX = Math.max(0, rawVpX);
  const vpY = Math.max(0, rawVpY);
  const vpW = Math.max(4, Math.min(rawVpW + Math.min(rawVpX, 0), MINIMAP_W - vpX));
  const vpH = Math.max(4, Math.min(rawVpH + Math.min(rawVpY, 0), MINIMAP_H - vpY));

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    setDragging(true);
    const pos = getGraphPos(e.clientX, e.clientY);
    if (pos) onMinimapClick(pos.x, pos.y);
  };

  return (
    <div
      className="fixed bottom-4 right-4 z-[60] rounded border border-white/10 bg-black/60 backdrop-blur-sm overflow-hidden"
      style={{ width: MINIMAP_W, height: MINIMAP_H }}
    >
      <svg
        ref={mmSvgRef}
        width={MINIMAP_W}
        height={MINIMAP_H}
        style={{ cursor: dragging ? "grabbing" : "crosshair" }}
        onMouseDown={handleMouseDown}
      >
        {/* Edges */}
        {edges.map((e) => (
          <line
            key={`me-${e.fromTxid}-${e.toTxid}`}
            x1={e.x1 * scale}
            y1={e.y1 * scale}
            x2={e.x2 * scale}
            y2={e.y2 * scale}
            stroke={e.consolidationCount >= 2 ? SVG_COLORS.critical : SVG_COLORS.muted}
            strokeWidth={e.consolidationCount >= 2 ? 1 : 0.5}
            strokeOpacity={e.consolidationCount >= 2 ? 0.6 : 0.3}
          />
        ))}
        {/* Nodes */}
        {layoutNodes.map((n) => {
          const heatScore = heatMapActive ? heatMap.get(n.txid)?.score : undefined;
          return (
            <rect
              key={`mn-${n.txid}`}
              x={n.x * scale}
              y={n.y * scale}
              width={n.width * scale}
              height={n.height * scale}
              rx={2}
              fill={getNodeColor(n, heatScore)}
              fillOpacity={0.6}
            />
          );
        })}
        {/* Viewport rectangle */}
        <rect
          x={vpX}
          y={vpY}
          width={vpW}
          height={vpH}
          fill="none"
          stroke={SVG_COLORS.bitcoin}
          strokeWidth={1.5}
          strokeOpacity={0.8}
          rx={2}
        />
      </svg>
    </div>
  );
}

// ─── Graph Canvas ──────────────────────────────────────────────

interface GraphCanvasProps extends GraphExplorerProps {
  containerWidth: number;
  containerHeight?: number;
  tooltip: ReturnType<typeof useChartTooltip<TooltipData>>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  filter: NodeFilter;
  hoveredNode: string | null;
  setHoveredNode: (txid: string | null) => void;
  selectedNode: { txid: string; x: number; y: number } | null;
  setSelectedNode: (node: { txid: string; x: number; y: number } | null) => void;
  focusedNode: string | null;
  setFocusedNode: (txid: string | null) => void;
  heatMap: Map<string, ScoringResult>;
  heatMapActive: boolean;
  isFullscreen?: boolean;
  viewTransform?: ViewTransform;
  onViewTransformChange?: (vt: ViewTransform) => void;
  linkabilityEdgeMode?: boolean;
}

function GraphCanvas({
  nodes,
  rootTxid,
  rootTxids,
  walletUtxos,
  nodeCount,
  maxNodes,
  loading,
  onExpandInput,
  onExpandOutput,
  onCollapse,
  containerWidth,
  containerHeight,
  tooltip,
  scrollRef,
  filter,
  hoveredNode,
  setHoveredNode,
  selectedNode,
  setSelectedNode,
  focusedNode,
  setFocusedNode,
  heatMap,
  heatMapActive,
  isFullscreen,
  viewTransform,
  onViewTransformChange,
  linkabilityEdgeMode,
  rootBoltzmannResult,
}: GraphCanvasProps) {
  const atCapacity = nodeCount >= maxNodes;
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panRef = useRef({ active: false, startX: 0, startY: 0, vtX: 0, vtY: 0, scale: 1 });
  const pinchRef = useRef({ active: false, startDist: 0, startScale: 1, midX: 0, midY: 0 });
  const viewTransformRef = useRef(viewTransform);
  viewTransformRef.current = viewTransform;
  const [isPanning, setIsPanning] = useState(false);

  // Convert graph coordinates to screen coordinates (accounts for scroll or view transform)
  const toScreen = useCallback((gx: number, gy: number) => {
    if (viewTransform) {
      return { x: gx * viewTransform.scale + viewTransform.x, y: gy * viewTransform.scale + viewTransform.y };
    }
    const sx = scrollRef.current?.scrollLeft ?? 0;
    const sy = scrollRef.current?.scrollTop ?? 0;
    return { x: gx - sx, y: gy - sy };
  }, [viewTransform, scrollRef]);
  const { layoutNodes, edges, width, height } = useMemo(
    () => layoutGraph(nodes, rootTxid, filter, rootTxids),
    [nodes, rootTxid, filter, rootTxids],
  );

  const svgWidth = Math.max(containerWidth, width);
  const svgHeight = Math.max(isFullscreen ? (containerHeight ?? height) : height, 150);

  // Edges connected to hovered node
  const hoveredEdges = useMemo(() => {
    if (!hoveredNode) return null;
    const set = new Set<string>();
    for (const e of edges) {
      if (e.fromTxid === hoveredNode || e.toTxid === hoveredNode) {
        set.add(`e-${e.fromTxid}-${e.toTxid}`);
      }
    }
    return set;
  }, [hoveredNode, edges]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!focusedNode && layoutNodes.length > 0) {
      setFocusedNode(layoutNodes[0].txid);
      return;
    }
    if (!focusedNode) return;

    const current = layoutNodes.find((n) => n.txid === focusedNode);
    if (!current) return;

    const sameDepth = layoutNodes.filter((n) => n.depth === current.depth);
    const currentIdx = sameDepth.findIndex((n) => n.txid === focusedNode);

    switch (e.key) {
      case "ArrowUp": {
        e.preventDefault();
        if (currentIdx > 0) setFocusedNode(sameDepth[currentIdx - 1].txid);
        break;
      }
      case "ArrowDown": {
        e.preventDefault();
        if (currentIdx < sameDepth.length - 1) setFocusedNode(sameDepth[currentIdx + 1].txid);
        break;
      }
      case "ArrowLeft": {
        e.preventDefault();
        const prevDepth = layoutNodes
          .filter((n) => n.depth < current.depth)
          .sort((a, b) => b.depth - a.depth)[0];
        if (prevDepth) setFocusedNode(prevDepth.txid);
        break;
      }
      case "ArrowRight": {
        e.preventDefault();
        const nextDepth = layoutNodes
          .filter((n) => n.depth > current.depth)
          .sort((a, b) => a.depth - b.depth)[0];
        if (nextDepth) setFocusedNode(nextDepth.txid);
        break;
      }
      case "Enter": {
        e.preventDefault();
        // Try to expand first available direction
        const gn = nodes.get(focusedNode);
        if (!gn) break;
        const inputIdx = gn.tx.vin.findIndex((v) => !v.is_coinbase && !nodes.has(v.txid));
        if (inputIdx >= 0 && !atCapacity) {
          onExpandInput(focusedNode, inputIdx);
        } else {
          const hasChild = Array.from(nodes.values()).some((n) => n.parentEdge?.fromTxid === focusedNode);
          if (!hasChild && !atCapacity) {
            const outIdx = gn.tx.vout.findIndex((_, i) =>
              !Array.from(nodes.values()).some((n) => n.parentEdge?.fromTxid === focusedNode && n.parentEdge?.outputIndex === i)
            );
            if (outIdx >= 0) onExpandOutput(focusedNode, outIdx);
          }
        }
        break;
      }
      case "Delete":
      case "Backspace": {
        e.preventDefault();
        if (focusedNode !== rootTxid) {
          onCollapse(focusedNode);
          setFocusedNode(rootTxid);
        }
        break;
      }
    }
  }, [focusedNode, layoutNodes, nodes, rootTxid, atCapacity, onExpandInput, onExpandOutput, onCollapse, setFocusedNode]);

  // Auto-scroll to keep focused node visible
  useEffect(() => {
    if (!focusedNode || !scrollRef.current) return;
    const node = layoutNodes.find((n) => n.txid === focusedNode);
    if (!node) return;
    const el = scrollRef.current;
    const nodeCenter = node.x + node.width / 2;
    const nodeMiddle = node.y + node.height / 2;
    const viewLeft = el.scrollLeft;
    const viewRight = viewLeft + el.clientWidth;
    const viewTop = el.scrollTop;
    const viewBottom = viewTop + el.clientHeight;

    if (nodeCenter < viewLeft + SCROLL_MARGIN_X || nodeCenter > viewRight - SCROLL_MARGIN_X) {
      el.scrollLeft = nodeCenter - el.clientWidth / 2;
    }
    if (nodeMiddle < viewTop + SCROLL_MARGIN_Y || nodeMiddle > viewBottom - SCROLL_MARGIN_Y) {
      el.scrollTop = nodeMiddle - el.clientHeight / 2;
    }
  }, [focusedNode, layoutNodes, scrollRef]);

  // Auto-scroll to center the root transaction node(s) on first render only
  const hasCentered = useRef(false);
  useEffect(() => {
    if (hasCentered.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const rootNodes = layoutNodes.filter((n) => n.isRoot);
    if (rootNodes.length === 0) return;
    hasCentered.current = true;
    const avgX = rootNodes.reduce((s, n) => s + n.x + n.width / 2, 0) / rootNodes.length;
    el.scrollLeft = avgX - el.clientWidth / 2;
  }, [layoutNodes, scrollRef]);

  // Handle node click - toggle floating analysis panel
  const handleNodeClick = useCallback((node: LayoutNode, currentSelected: string | null) => {
    // Toggle off if clicking the same node
    if (currentSelected === node.txid) {
      setSelectedNode(null);
      return;
    }
    // Open for new node - centered above
    const pos = toScreen(node.x + node.width / 2, node.y);
    setSelectedNode({
      txid: node.txid,
      x: pos.x,
      y: pos.y,
    });
  }, [setSelectedNode, toScreen]);

  // Minimap scroll handler
  const [scrollPos, setScrollPos] = useState({ left: 0, top: 0 });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => setScrollPos({ left: el.scrollLeft, top: el.scrollTop });
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, [scrollRef]);

  const handleMinimapClick = useCallback((x: number, y: number) => {
    if (viewTransform && onViewTransformChange) {
      const cw = containerWidth;
      const ch = containerHeight ?? 600;
      onViewTransformChange({ ...viewTransform, x: cw / 2 - x * viewTransform.scale, y: ch / 2 - y * viewTransform.scale });
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = x - el.clientWidth / 2;
    el.scrollTop = y - el.clientHeight / 2;
  }, [scrollRef, viewTransform, onViewTransformChange, containerWidth, containerHeight]);

  // ─── Pan handlers (fullscreen transform mode) ────────────

  const handlePanStart = useCallback((e: React.MouseEvent) => {
    if (!viewTransform || !onViewTransformChange || e.button !== 0) return;
    e.preventDefault();
    panRef.current = { active: true, startX: e.clientX, startY: e.clientY, vtX: viewTransform.x, vtY: viewTransform.y, scale: viewTransform.scale };
    setIsPanning(true);
    setSelectedNode(null);
  }, [viewTransform, onViewTransformChange, setSelectedNode]);

  useEffect(() => {
    if (!isPanning) return;
    const onMove = (e: MouseEvent) => {
      if (!panRef.current.active) return;
      const dx = e.clientX - panRef.current.startX;
      const dy = e.clientY - panRef.current.startY;
      onViewTransformChange?.({ scale: panRef.current.scale, x: panRef.current.vtX + dx, y: panRef.current.vtY + dy });
    };
    const onUp = () => { panRef.current.active = false; setIsPanning(false); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, [isPanning, onViewTransformChange]);

  // Wheel-to-zoom (fullscreen transform mode)
  useEffect(() => {
    if (!viewTransform || !onViewTransformChange) return;
    const el = svgRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const vt = viewTransformRef.current;
      if (!vt) return;
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const gx = (cx - vt.x) / vt.scale;
      const gy = (cy - vt.y) / vt.scale;
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const ns = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vt.scale * factor));
      onViewTransformChange({ x: cx - gx * ns, y: cy - gy * ns, scale: ns });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!viewTransform, onViewTransformChange]);

  // Touch gestures: single-finger pan, two-finger pinch-to-zoom
  // Attached to the wrapper div (not SVG) because mobile browsers have
  // unreliable touch hit-testing on SVG backgrounds/empty space.
  // Uses a move threshold (PAN_THRESHOLD) so taps on buttons/nodes still fire
  // as clicks - panning only activates after the finger moves enough pixels.
  useEffect(() => {
    if (!viewTransform || !onViewTransformChange) return;
    const el = wrapperRef.current;
    if (!el) return;

    const PAN_THRESHOLD = 8; // px - must move this far before pan activates
    const dist = (a: Touch, b: Touch) =>
      Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    // "pending" = finger is down but hasn't moved enough to be a pan yet
    let pendingPan: { startX: number; startY: number; vtX: number; vtY: number; scale: number } | null = null;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        // Pinch start - always immediate, unambiguous gesture
        e.preventDefault();
        pendingPan = null;
        const vt = viewTransformRef.current;
        if (!vt) return;
        const t0 = e.touches[0], t1 = e.touches[1];
        const rect = el.getBoundingClientRect();
        pinchRef.current = {
          active: true,
          startDist: dist(t0, t1),
          startScale: vt.scale,
          midX: (t0.clientX + t1.clientX) / 2 - rect.left,
          midY: (t0.clientY + t1.clientY) / 2 - rect.top,
        };
        panRef.current.active = false;
      } else if (e.touches.length === 1) {
        // Record start position but DON'T activate pan yet.
        // Let the browser generate click events for taps on buttons/nodes.
        const vt = viewTransformRef.current;
        if (!vt) return;
        const t = e.touches[0];
        pendingPan = { startX: t.clientX, startY: t.clientY, vtX: vt.x, vtY: vt.y, scale: vt.scale };
        pinchRef.current.active = false;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (pinchRef.current.active && e.touches.length === 2) {
        e.preventDefault();
        const vt = viewTransformRef.current;
        if (!vt) return;
        const t0 = e.touches[0], t1 = e.touches[1];
        const curDist = dist(t0, t1);
        const ratio = curDist / pinchRef.current.startDist;
        const ns = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchRef.current.startScale * ratio));
        const { midX, midY } = pinchRef.current;
        const gx = (midX - vt.x) / vt.scale;
        const gy = (midY - vt.y) / vt.scale;
        onViewTransformChange({ x: midX - gx * ns, y: midY - gy * ns, scale: ns });
      } else if (e.touches.length === 1) {
        const t = e.touches[0];

        // Check if pending pan should activate (moved past threshold)
        if (pendingPan && !panRef.current.active) {
          const moved = Math.hypot(t.clientX - pendingPan.startX, t.clientY - pendingPan.startY);
          if (moved >= PAN_THRESHOLD) {
            // Activate pan
            panRef.current = { active: true, startX: pendingPan.startX, startY: pendingPan.startY, vtX: pendingPan.vtX, vtY: pendingPan.vtY, scale: pendingPan.scale };
            pendingPan = null;
            setIsPanning(true);
            setSelectedNode(null);
          }
        }

        if (panRef.current.active) {
          e.preventDefault();
          const dx = t.clientX - panRef.current.startX;
          const dy = t.clientY - panRef.current.startY;
          onViewTransformChange({ scale: panRef.current.scale, x: panRef.current.vtX + dx, y: panRef.current.vtY + dy });
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      pendingPan = null;
      if (e.touches.length < 2) pinchRef.current.active = false;
      if (e.touches.length === 0) {
        panRef.current.active = false;
        setIsPanning(false);
      }
      // If going from 2 fingers to 1, record as pending pan
      if (e.touches.length === 1 && !pinchRef.current.active) {
        const vt = viewTransformRef.current;
        if (!vt) return;
        const t = e.touches[0];
        pendingPan = { startX: t.clientX, startY: t.clientY, vtX: vt.x, vtY: vt.y, scale: vt.scale };
      }
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: false });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd, { passive: false });
    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!viewTransform, onViewTransformChange]);

  return (
    <div
      ref={wrapperRef}
      className="relative"
      style={{ minWidth: svgWidth, ...(viewTransform ? { touchAction: "none" } : {}) }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <svg
        ref={svgRef}
        width={viewTransform ? containerWidth : svgWidth}
        height={viewTransform ? (containerHeight ?? svgHeight) : svgHeight}
        className="overflow-visible"
        style={viewTransform ? { cursor: isPanning ? "grabbing" : "grab", touchAction: "none" } : undefined}
        onClick={(e) => {
          // Close analysis panel when clicking SVG background (not a node)
          if (e.target === e.currentTarget) setSelectedNode(null);
        }}
      >
        <ChartDefs />
        <defs>
          {/* Arrow at path end (forward edges, left-to-right) */}
          <marker id="arrow-graph" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6" fill={SVG_COLORS.muted} fillOpacity={0.5} />
          </marker>
          {/* Arrow at path start (backward edges, reversed path draws right-to-left) */}
          <marker id="arrow-graph-start" markerWidth="8" markerHeight="6" refX="1" refY="3" orient="auto-start-reverse">
            <path d="M0,0 L8,3 L0,6" fill={SVG_COLORS.muted} fillOpacity={0.5} />
          </marker>
          {/* Red arrows for consolidation edges */}
          <marker id="arrow-graph-consolidation" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6" fill={SVG_COLORS.critical} fillOpacity={0.7} />
          </marker>
          <marker id="arrow-graph-consolidation-start" markerWidth="8" markerHeight="6" refX="1" refY="3" orient="auto-start-reverse">
            <path d="M0,0 L8,3 L0,6" fill={SVG_COLORS.critical} fillOpacity={0.7} />
          </marker>
        </defs>
        <style>{`
          .graph-btn circle { transition: fill-opacity 0.15s, stroke-width 0.15s, filter 0.15s; }
          .graph-btn:hover circle { fill-opacity: 1; stroke-width: 2.5; filter: brightness(1.4); }
          .graph-btn:hover text { fill-opacity: 1; }
        `}</style>

        {/* Pan target: full-coverage background rect (fullscreen transform mode).
            Uses fillOpacity=0 instead of fill="transparent" because some mobile
            browsers skip transparent fills for touch hit-testing. */}
        {viewTransform && (
          <rect
            width={containerWidth}
            height={containerHeight ?? svgHeight}
            fill="black"
            fillOpacity={0}
            pointerEvents="all"
            onMouseDown={handlePanStart}
          />
        )}

        <g transform={viewTransform ? `translate(${viewTransform.x},${viewTransform.y}) scale(${viewTransform.scale})` : undefined}>

        {/* Edges */}
        {edges.map((edge) => {
          const edgeKey = `e-${edge.fromTxid}-${edge.toTxid}`;
          const d = edgePath(edge);
          const midX = (edge.x1 + edge.x2) / 2;

          const isHoveredViaNode = hoveredEdges?.has(edgeKey);
          const isHoveredDirect = hoveredEdgeKey === edgeKey;
          const isHovered = isHoveredViaNode || isHoveredDirect;
          const isDimmedByHover = hoveredNode && !isHoveredViaNode;
          const isConsolidation = edge.consolidationCount >= 2;

          // Linkability edge coloring: only for root tx edges with Boltzmann data
          let linkabilityColor: string | null = null;
          let linkabilityMaxProb = -1;
          if (linkabilityEdgeMode && rootBoltzmannResult && edge.fromTxid === rootTxid && edge.outputIndices?.length) {
            const mat = rootBoltzmannResult.matLnkProbabilities;
            if (mat && mat.length > 0) {
              linkabilityMaxProb = getEdgeMaxProb(mat, edge.outputIndices);
              if (linkabilityMaxProb <= 0) return null; // Skip 0% linkability edges entirely
              linkabilityColor = probColor(linkabilityMaxProb);
            }
          }

          const strokeColor = linkabilityColor ?? (isConsolidation ? SVG_COLORS.critical : SVG_COLORS.muted);
          let strokeOpacity = linkabilityColor ? (0.3 + linkabilityMaxProb * 0.7) : (isConsolidation ? 0.6 : 0.35);
          let strokeWidth = linkabilityColor ? 2.5 : (isConsolidation ? 2.5 : 1.5);

          if (isHovered && !linkabilityColor) {
            strokeOpacity = isConsolidation ? 0.9 : 0.7;
            strokeWidth = isConsolidation ? 3.5 : 2.5;
          }
          if (isDimmedByHover) strokeOpacity = isConsolidation ? 0.2 : 0.1;

          // Select appropriate arrow markers
          let markerEnd: string | undefined;
          let markerStart: string | undefined;
          if (edge.isBackward) {
            markerStart = isConsolidation ? "url(#arrow-graph-consolidation-start)" : "url(#arrow-graph-start)";
          } else {
            markerEnd = isConsolidation ? "url(#arrow-graph-consolidation)" : "url(#arrow-graph)";
          }

          // Edge tooltip prob: reuse already-computed linkability max prob
          const edgeMaxProb = linkabilityMaxProb >= 0 ? linkabilityMaxProb : undefined;

          return (
            <g key={edgeKey}>
              {/* Invisible wider hit target for edge hover */}
              {edgeMaxProb !== undefined && (
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={12}
                  style={{ cursor: "default" }}
                  onMouseMove={(e: React.MouseEvent) => {
                    setHoveredEdgeKey(edgeKey);
                    const svgEl = svgRef.current;
                    if (!svgEl) return;
                    const svgRect = svgEl.getBoundingClientRect();
                    tooltip.showTooltip({
                      tooltipData: {
                        txid: edge.fromTxid,
                        inputCount: 0, outputCount: 0, totalValue: 0,
                        isCoinJoin: false, depth: 0, fee: 0, feeRate: "",
                        confirmed: true, linkProb: edgeMaxProb,
                      },
                      tooltipLeft: e.clientX - svgRect.left,
                      tooltipTop: e.clientY - svgRect.top - 8,
                    });
                  }}
                  onMouseLeave={() => { setHoveredEdgeKey(null); tooltip.hideTooltip(); }}
                />
              )}
              <motion.path
                d={d}
                fill="none"
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                strokeOpacity={strokeOpacity}
                strokeDasharray={edge.isBackward ? "6 4" : undefined}
                markerEnd={markerEnd}
                markerStart={markerStart}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.4 }}
                style={{ pointerEvents: "none" }}
              />
              {/* Consolidation count label on the edge */}
              {isConsolidation && (
                <Text
                  x={midX}
                  y={(edge.y1 + edge.y2) / 2 - 6}
                  textAnchor="middle"
                  fontSize={9}
                  fontWeight={700}
                  fill={SVG_COLORS.critical}
                  fillOpacity={isDimmedByHover ? 0.15 : 0.85}
                  style={{ pointerEvents: "none" as const }}
                >
                  {`${edge.consolidationCount} outputs`}
                </Text>
              )}
            </g>
          );
        })}

        {/* Hover overlay: re-render hovered linkability edge on top of all edges */}
        {hoveredEdgeKey && linkabilityEdgeMode && rootBoltzmannResult && (() => {
          const edge = edges.find((e) => `e-${e.fromTxid}-${e.toTxid}` === hoveredEdgeKey);
          if (!edge || edge.fromTxid !== rootTxid || !edge.outputIndices?.length) return null;
          const mat = rootBoltzmannResult.matLnkProbabilities;
          if (!mat?.length) return null;
          const maxProb = getEdgeMaxProb(mat, edge.outputIndices);
          if (maxProb <= 0) return null;
          const d = edgePath(edge);
          const color = probColor(maxProb);
          return (
            <g style={{ pointerEvents: "none" }}>
              {/* Glow aura */}
              <path d={d} fill="none" stroke={color} strokeWidth={6.5} strokeOpacity={0.4} filter="url(#glow-medium)" />
              {/* Solid edge at full opacity */}
              <path d={d} fill="none" stroke={color} strokeWidth={2.5} strokeOpacity={1.0}
                strokeDasharray={edge.isBackward ? "6 4" : undefined} />
            </g>
          );
        })()}

        {/* Nodes */}
        {layoutNodes.map((node) => {
          const heatScore = heatMapActive ? heatMap.get(node.txid)?.score : undefined;
          const color = getNodeColor(node, heatScore);
          const totalValue = node.tx.vout.reduce((s, o) => s + o.value, 0);
          const isHovered = hoveredNode === node.txid;
          const isFocused = focusedNode === node.txid;
          const isDimmedByHover = hoveredNode && !isHovered && !hoveredEdges?.has(`e-${hoveredNode}-${node.txid}`) && !hoveredEdges?.has(`e-${node.txid}-${hoveredNode}`);
          const isConnectedToHovered = hoveredNode && (
            edges.some((e) => (e.fromTxid === hoveredNode && e.toTxid === node.txid) || (e.toTxid === hoveredNode && e.fromTxid === node.txid))
          );
          const isLoading = loading.has(node.txid);

          let nodeOpacity = 1;
          if (isDimmedByHover && !isConnectedToHovered) nodeOpacity = 0.3;

          return (
            <motion.g
              key={node.txid}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{
                opacity: nodeOpacity,
                scale: 1,
              }}
              transition={{ duration: 0.3 }}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => {
                setHoveredNode(node.txid);
                const pos = toScreen(node.x + node.width / 2, node.y - 8);
                tooltip.showTooltip({
                  tooltipData: {
                    txid: node.txid,
                    inputCount: node.inputCount,
                    outputCount: node.outputCount,
                    totalValue,
                    isCoinJoin: node.isCoinJoin,
                    coinJoinType: node.coinJoinType,
                    entityLabel: node.entityLabel,
                    entityCategory: node.entityCategory,
                    entityOfac: node.entityOfac,
                    entityConfidence: node.entityConfidence,
                    depth: node.depth,
                    fee: node.fee,
                    feeRate: node.feeRate,
                    confirmed: node.confirmed,
                  },
                  tooltipLeft: pos.x,
                  tooltipTop: pos.y,
                });
              }}
              onMouseLeave={() => {
                setHoveredNode(null);
                tooltip.hideTooltip();
              }}
            >
              {/* Node background */}
              <rect
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                rx={8}
                fill={heatMapActive && heatScore !== undefined ? `${color}20` : SVG_COLORS.surfaceElevated}
                stroke={color}
                strokeWidth={isHovered ? 2.5 : (node.isRoot ? 2.5 : 1.5)}
                strokeOpacity={isHovered || node.isRoot ? 1 : 0.6}
                filter={node.isRoot ? "url(#glow-medium)" : (isHovered ? "url(#glow-subtle)" : undefined)}
                onClick={() => handleNodeClick(node, selectedNode?.txid ?? null)}
              />

              {/* Focused node indicator (dashed animated outline) */}
              {isFocused && (
                <rect
                  x={node.x - 3}
                  y={node.y - 3}
                  width={node.width + 6}
                  height={node.height + 6}
                  rx={10}
                  fill="none"
                  stroke={SVG_COLORS.bitcoin}
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  strokeOpacity={0.7}
                >
                  <animate attributeName="stroke-dashoffset" values="0;8" dur="0.8s" repeatCount="indefinite" />
                </rect>
              )}

              {/* Loading pulse overlay */}
              {isLoading && (
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx={8}
                  fill={color}
                  fillOpacity={0.15}
                >
                  <animate attributeName="fill-opacity" values="0.05;0.2;0.05" dur="1.2s" repeatCount="indefinite" />
                </rect>
              )}

              {/* CoinJoin diamond badge */}
              {node.isCoinJoin && (
                <polygon
                  points={`${node.x + node.width - 12},${node.y + 4} ${node.x + node.width - 6},${node.y + 10} ${node.x + node.width - 12},${node.y + 16} ${node.x + node.width - 18},${node.y + 10}`}
                  fill={SVG_COLORS.good}
                  fillOpacity={0.3}
                  stroke={SVG_COLORS.good}
                  strokeWidth={1}
                />
              )}

              {/* OFAC warning triangle */}
              {node.entityOfac && (
                <g transform={`translate(${node.x + node.width - 24}, ${node.y + 4})`}>
                  <polygon points="6,0 12,10 0,10" fill={SVG_COLORS.critical} fillOpacity={0.8} />
                  <text x="6" y="9" textAnchor="middle" fontSize="7" fontWeight="bold" fill="#0c0c0e">!</text>
                </g>
              )}

              {/* Heat map score */}
              {heatMapActive && heatScore !== undefined && (
                <Text
                  x={node.x + node.width - 20}
                  y={node.y + NODE_H / 2 + 6}
                  fontSize={18}
                  fontWeight={800}
                  fill={color}
                  textAnchor="middle"
                  opacity={0.9}
                >
                  {heatScore}
                </Text>
              )}

              {/* Txid label */}
              <Text
                x={node.x + 10}
                y={node.y + 20}
                fontSize={11}
                fill={color}
                fontWeight={600}
                fontFamily="monospace"
              >
                {truncateId(node.txid, 8)}
              </Text>

              {/* Summary line */}
              <Text
                x={node.x + 10}
                y={node.y + 38}
                fontSize={10}
                fill={SVG_COLORS.muted}
              >
                {`${node.inputCount}in / ${node.outputCount}out - ${formatSats(totalValue)}`}
              </Text>

              {/* Entity label + category */}
              {node.entityLabel && (
                <>
                  <Text
                    x={node.x + 10}
                    y={node.y + 50}
                    fontSize={9}
                    fill={ENTITY_CATEGORY_COLORS[node.entityCategory ?? "unknown"]}
                    fontWeight={500}
                  >
                    {node.entityLabel}
                  </Text>
                </>
              )}

              {/* Wallet UTXO badge */}
              {walletUtxos?.has(node.txid) && (() => {
                const vouts = walletUtxos.get(node.txid)!;
                const utxoSats = [...vouts].reduce((sum, vi) => sum + (node.tx.vout[vi]?.value ?? 0), 0);
                return (
                  <g>
                    <rect
                      x={node.x}
                      y={node.y + node.height + 2}
                      width={node.width}
                      height={18}
                      rx={4}
                      fill={SVG_COLORS.bitcoin}
                      fillOpacity={0.15}
                      stroke={SVG_COLORS.bitcoin}
                      strokeWidth={0.5}
                      strokeOpacity={0.4}
                    />
                    <Text
                      x={node.x + node.width / 2}
                      y={node.y + node.height + 14}
                      fontSize={9}
                      fill={SVG_COLORS.bitcoin}
                      textAnchor="middle"
                      fontWeight={600}
                    >
                      {vouts.size === 1 ? `Wallet: ${formatSats(utxoSats)}` : `${vouts.size} outputs: ${formatSats(utxoSats)}`}
                    </Text>
                  </g>
                );
              })()}

              {/* Transparent click overlay - captures clicks on text/badges inside the node */}
              <rect
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                rx={8}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onClick={() => handleNodeClick(node, selectedNode?.txid ?? null)}
              />

              {/* Expand left button (backward) */}
              {!atCapacity && node.depth <= 0 && (() => {
                const idx = node.tx.vin.findIndex((v) => !v.is_coinbase && !nodes.has(v.txid));
                return idx >= 0 ? (
                  <g className="graph-btn" style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onExpandInput(node.txid, idx); }}>
                    <circle cx={node.x - 6} cy={node.y + NODE_H / 2} r={11} fill={SVG_COLORS.surfaceElevated} stroke={color} strokeWidth={1.5} />
                    <Text x={node.x - 6} y={node.y + NODE_H / 2 + 5} fontSize={16} fontWeight={700} textAnchor="middle" fill={color}>+</Text>
                  </g>
                ) : null;
              })()}

              {/* Expand right button (forward) */}
              {!atCapacity && (() => {
                // Build set of output indices already consumed by nodes in the graph.
                // Check ALL nodes' inputs to see if they spend from this tx.
                const consumedOutputs = new Set<number>();
                for (const [, n] of nodes) {
                  for (const vin of n.tx.vin) {
                    if (vin.txid === node.txid && vin.vout !== undefined) {
                      consumedOutputs.add(vin.vout);
                    }
                  }
                }
                // Also count unspendable outputs (OP_RETURN, 0-value)
                for (let i = 0; i < node.tx.vout.length; i++) {
                  const out = node.tx.vout[i];
                  if (out.scriptpubkey_type === "op_return" || out.value === 0) {
                    consumedOutputs.add(i);
                  }
                }
                if (consumedOutputs.size >= node.tx.vout.length) return null;
                const idx = node.tx.vout.findIndex((_, i) => !consumedOutputs.has(i));
                return idx >= 0 ? (
                  <g className="graph-btn" style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onExpandOutput(node.txid, idx); }}>
                    <circle cx={node.x + node.width + 6} cy={node.y + NODE_H / 2} r={11} fill={SVG_COLORS.surfaceElevated} stroke={color} strokeWidth={1.5} />
                    <Text x={node.x + node.width + 6} y={node.y + NODE_H / 2 + 5} fontSize={16} fontWeight={700} textAnchor="middle" fill={color}>+</Text>
                  </g>
                ) : null;
              })()}

              {/* Collapse button for non-root nodes */}
              {!node.isRoot && (
                <g className="graph-btn" style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onCollapse(node.txid); }}>
                  <circle cx={node.x + node.width - 8} cy={node.y + NODE_H - 6} r={9} fill={SVG_COLORS.surfaceInset} stroke={SVG_COLORS.muted} strokeWidth={1} />
                  <Text x={node.x + node.width - 8} y={node.y + NODE_H - 2} fontSize={12} fontWeight={700} textAnchor="middle" fill={SVG_COLORS.muted}>x</Text>
                </g>
              )}
            </motion.g>
          );
        })}
        </g>
      </svg>

      {/* Minimap - only in fullscreen */}
      {isFullscreen && (
        <Minimap
          layoutNodes={layoutNodes}
          edges={edges}
          graphWidth={width}
          graphHeight={height}
          viewportWidth={viewTransform ? containerWidth / viewTransform.scale : containerWidth}
          viewportHeight={viewTransform ? (containerHeight ?? 600) / viewTransform.scale : (containerHeight ?? 600)}
          scrollLeft={viewTransform ? -viewTransform.x / viewTransform.scale : scrollPos.left}
          scrollTop={viewTransform ? -viewTransform.y / viewTransform.scale : scrollPos.top}
          onMinimapClick={handleMinimapClick}
          heatMap={heatMap}
          heatMapActive={heatMapActive}
        />
      )}
    </div>
  );
}

// ─── Toolbar Icons ─────────────────────────────────────────────

function ExpandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function CloseIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function HeatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2c0 5-4 7-4 12a4 4 0 0 0 8 0c0-5-4-7-4-12z" />
    </svg>
  );
}

function GraphIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none">
      <circle cx="4" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="4" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 7l4-2M6 9l4 2" stroke="currentColor" strokeWidth="1" strokeOpacity="0.5" />
    </svg>
  );
}

// ─── Main Component ────────────────────────────────────────────

export function GraphExplorer(props: GraphExplorerProps) {
  const { t } = useTranslation();
  const tooltip = useChartTooltip<TooltipData>();
  const scrollRef = useRef<HTMLDivElement>(null);

  // State
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<{ txid: string; x: number; y: number } | null>(null);
  const [focusedNode, setFocusedNode] = useState<string | null>(null);
  const [filter, setFilter] = useState<NodeFilter>({ showCoinJoin: true, showEntity: true, showStandard: true });

  // View transform for fullscreen pan/zoom
  const [viewTransform, setViewTransform] = useState<ViewTransform | undefined>(undefined);

  // Fullscreen toggle (onExit clears selection + view transform)
  const handleFullscreenExit = useCallback(() => {
    setSelectedNode(null);
    setViewTransform(undefined);
  }, []);
  const { isExpanded, expand: expandFullscreen, collapse: collapseFullscreen } = useFullscreen(handleFullscreenExit);

  // Linkability edge mode
  const [linkabilityEdgeMode, setLinkabilityEdgeMode] = useState(false);
  const hasLinkability = !!props.rootBoltzmannResult;

  // Heat map state
  const [heatMapActive, setHeatMapActive] = useState(false);
  const [heatMap, setHeatMap] = useState<Map<string, ScoringResult>>(new Map());
  const [heatProgress, setHeatProgress] = useState(0);

  // Zoom toward center helper
  const zoomBy = useCallback((factor: number) => {
    if (!viewTransform) return;
    const cw = window.innerWidth - 32;
    const ch = window.innerHeight - 160;
    const cx = cw / 2;
    const cy = ch / 2;
    const gx = (cx - viewTransform.x) / viewTransform.scale;
    const gy = (cy - viewTransform.y) / viewTransform.scale;
    const s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewTransform.scale * factor));
    setViewTransform({ x: cx - gx * s, y: cy - gy * s, scale: s });
  }, [viewTransform]);

  // Heat map computation
  useEffect(() => {
    if (!heatMapActive) return;
    const analyze = analyzeTransactionSync;
    const nodeEntries = Array.from(props.nodes.entries());
    const results = new Map<string, ScoringResult>();
    let idx = 0;

    // Use requestIdleCallback for non-blocking analysis
    function processNext() {
      const start = performance.now();
      while (idx < nodeEntries.length && performance.now() - start < 16) {
        const [txid, gn] = nodeEntries[idx];
        if (!results.has(txid)) {
          results.set(txid, analyze(gn.tx));
        }
        idx++;
        setHeatProgress(Math.round((idx / nodeEntries.length) * 100));
      }
      setHeatMap(new Map(results));
      if (idx < nodeEntries.length) {
        requestAnimationFrame(processNext);
      }
    }

    processNext();
  }, [heatMapActive, props.nodes]);

  // Count hidden nodes
  const totalNodes = props.nodeCount;
  const atCapacity = props.nodeCount >= props.maxNodes;
  const visibleCount = useMemo(() => {
    return layoutGraph(props.nodes, props.rootTxid, filter, props.rootTxids).layoutNodes.length;
  }, [props.nodes, props.rootTxid, filter, props.rootTxids]);
  const hiddenCount = totalNodes - visibleCount;

  if (props.nodes.size === 0) return null;

  // Toggle filter helpers
  const toggleFilter = (key: keyof NodeFilter) => {
    setFilter((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // ─── Toolbar ───────────────────────────────────────────

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-white/70 min-w-0">
        <GraphIcon />
        <span className="truncate">{t("graphExplorer.title", { defaultValue: "Transaction Graph" })}</span>
        <span className={`text-xs font-normal hidden sm:inline ${atCapacity ? "text-amber-400" : "text-white/40"}`}>
          {t("graphExplorer.nodeCount", { count: props.nodeCount, max: props.maxNodes, defaultValue: "({{count}}/{{max}} nodes)" })}
          {hiddenCount > 0 && (
            <span className="ml-1 text-white/30">
              ({hiddenCount} {t("graphExplorer.hidden", { defaultValue: "hidden" })})
            </span>
          )}
        </span>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {/* Heat map toggle */}
        <button
          onClick={() => setHeatMapActive(!heatMapActive)}
          className={`text-xs transition-colors px-2 py-1 rounded border cursor-pointer ${
            heatMapActive
              ? "text-bitcoin border-bitcoin/30 bg-bitcoin/10"
              : "text-white/50 hover:text-white/80 border-white/10"
          }`}
          title={t("graphExplorer.heatMap", { defaultValue: "Heat Map" })}
        >
          <span className="flex items-center gap-1">
            <HeatIcon />
            <span className="hidden sm:inline">
              {heatMapActive && heatProgress < 100
                ? `${heatProgress}%`
                : t("graphExplorer.heatMap", { defaultValue: "Heat Map" })}
            </span>
          </span>
        </button>

        {/* Linkability edge mode toggle */}
        {hasLinkability && (
          <button
            onClick={() => setLinkabilityEdgeMode(!linkabilityEdgeMode)}
            className={`text-xs transition-colors px-2 py-1 rounded border cursor-pointer ${
              linkabilityEdgeMode
                ? "text-bitcoin border-bitcoin/30 bg-bitcoin/10"
                : "text-white/50 hover:text-white/80 border-white/10"
            }`}
            title={t("graphExplorer.linkability", { defaultValue: "Color edges by linkability" })}
          >
            <span className="flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
              <span className="hidden sm:inline">{t("graphExplorer.linkability", { defaultValue: "Linkability" })}</span>
            </span>
          </button>
        )}

        {/* Undo */}
        <button
          onClick={props.onUndo}
          disabled={!props.canUndo}
          className={`text-xs transition-colors px-2 py-1 rounded border border-white/10 ${
            props.canUndo
              ? "text-white/50 hover:text-white/80 cursor-pointer"
              : "text-white/20 cursor-not-allowed"
          }`}
        >
          {t("common.undo", { defaultValue: "Undo" })}
        </button>

        {/* Reset */}
        {props.nodeCount > 1 && (
          <button
            onClick={props.onReset}
            className="text-xs text-white/50 hover:text-white/80 transition-colors px-2 py-1 rounded border border-white/10 cursor-pointer"
          >
            {t("common.reset", { defaultValue: "Reset" })}
          </button>
        )}

        {/* Fullscreen toggle */}
        <button
          onClick={() => {
            expandFullscreen();
            // Center on root node(s) at 1:1 scale
            const { layoutNodes: ln } = layoutGraph(props.nodes, props.rootTxid, filter, props.rootTxids);
            const roots = ln.filter((n) => n.isRoot);
            const cw = window.innerWidth - 32;
            const ch = window.innerHeight - 160;
            if (roots.length > 0) {
              const avgX = roots.reduce((s, n) => s + n.x + n.width / 2, 0) / roots.length;
              const avgY = roots.reduce((s, n) => s + n.y + n.height / 2, 0) / roots.length;
              setViewTransform({ x: cw / 2 - avgX, y: ch / 2 - avgY, scale: 1 });
            } else {
              setViewTransform({ x: 0, y: 0, scale: 1 });
            }
          }}
          className="text-white/50 hover:text-white/80 transition-colors p-1 rounded border border-white/10 cursor-pointer"
          title={t("graphExplorer.fullscreen", { defaultValue: "Fullscreen" })}
        >
          <ExpandIcon />
        </button>
      </div>
    </div>
  );

  // ─── Instructions ──────────────────────────────────────

  const instructions = (
    <div className="text-xs text-white/40">
      {t("graphExplorer.instructions", { defaultValue: "Click + buttons on nodes to expand the graph. Click node to analyze." })}
    </div>
  );

  // ─── Legend (clickable filters) ────────────────────────

  const legend = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/40">
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-2.5 h-2.5 rounded-sm border-2" style={{ borderColor: SVG_COLORS.bitcoin, background: "transparent" }} />
        {t("graphExplorer.legendRoot", { defaultValue: "Analyzed tx" })}
      </span>
      <button
        onClick={() => toggleFilter("showCoinJoin")}
        className={`flex items-center gap-1.5 cursor-pointer transition-opacity ${filter.showCoinJoin ? "opacity-100" : "opacity-40 line-through"}`}
      >
        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: SVG_COLORS.good }} />
        {t("graphExplorer.legendCoinJoin", { defaultValue: "CoinJoin" })}
      </button>
      <button
        onClick={() => toggleFilter("showStandard")}
        className={`flex items-center gap-1.5 cursor-pointer transition-opacity ${filter.showStandard ? "opacity-100" : "opacity-40 line-through"}`}
      >
        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: SVG_COLORS.low }} />
        {t("graphExplorer.legendDefault", { defaultValue: "Standard tx" })}
      </button>
      {props.walletUtxos && (
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: SVG_COLORS.bitcoin, opacity: 0.3 }} />
          {t("graphExplorer.legendWalletOutput", { defaultValue: "Wallet output" })}
        </span>
      )}
      {/* Entity category legend - each dot is colored per category, whole group toggles entity filter */}
      <span className="text-white/20">|</span>
      {([
        ["exchange", "Exchange"],
        ["darknet", "Darknet"],
        ["mixer", "Mixer"],
        ["gambling", "Gambling"],
        ["mining", "Mining"],
      ] as const).map(([cat, label]) => (
        <button
          key={cat}
          onClick={() => toggleFilter("showEntity")}
          className={`flex items-center gap-1 cursor-pointer transition-opacity ${filter.showEntity ? "opacity-100" : "opacity-40 line-through"}`}
        >
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: ENTITY_CATEGORY_COLORS[cat] }} />
          <span className="text-white/40">{label}</span>
        </button>
      ))}
      <span className="text-white/20">|</span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-4 h-0.5 rounded" style={{ background: SVG_COLORS.critical, opacity: 0.7 }} />
        <span className="text-white/40">{t("graphExplorer.legendConsolidation", { defaultValue: "Consolidation" })}</span>
      </span>
    </div>
  );

  // ─── Shared canvas props ───────────────────────────────

  const canvasProps = {
    ...props,
    tooltip,
    scrollRef,
    filter,
    hoveredNode,
    setHoveredNode,
    selectedNode,
    setSelectedNode,
    focusedNode,
    setFocusedNode,
    heatMap,
    heatMapActive,
    linkabilityEdgeMode,
  };

  const fullscreenCanvasProps = {
    ...canvasProps,
    viewTransform,
    onViewTransformChange: setViewTransform,
  };

  // ─── Tooltip content ──────────────────────────────────

  const tooltipContent = tooltip.tooltipOpen && tooltip.tooltipData && (
    <ChartTooltip top={tooltip.tooltipTop} left={tooltip.tooltipLeft} containerRef={scrollRef}>
      {tooltip.tooltipData.linkProb !== undefined ? (
        <div className="space-y-0.5">
          <div className="text-xs font-medium flex items-center gap-1.5">
            <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: probColor(tooltip.tooltipData.linkProb), display: "inline-block", flexShrink: 0 }} />
            <span style={{ color: SVG_COLORS.foreground }}>{Math.round(tooltip.tooltipData.linkProb * 100)}% linkability</span>
          </div>
          <div className="text-xs" style={{ color: SVG_COLORS.muted }}>
            {t("graphExplorer.linkability", { defaultValue: "Max output linkability" })}
          </div>
        </div>
      ) : (
      <div className="space-y-1">
        <div className="font-mono text-xs">{truncateId(tooltip.tooltipData.txid, 8)}</div>
        <div className="text-xs" style={{ color: SVG_COLORS.muted }}>
          {tooltip.tooltipData.inputCount} {t("graphExplorer.inputs", { defaultValue: "inputs" })}, {tooltip.tooltipData.outputCount} {t("graphExplorer.outputs", { defaultValue: "outputs" })}
        </div>
        <div className="text-xs" style={{ color: SVG_COLORS.bitcoin }}>
          {formatSats(tooltip.tooltipData.totalValue)}
        </div>
        {/* Fee info */}
        <div className="text-xs" style={{ color: SVG_COLORS.muted }}>
          {t("graphExplorer.fee", {
            fee: formatSats(tooltip.tooltipData.fee),
            rate: tooltip.tooltipData.feeRate,
            defaultValue: "Fee: {{fee}} ({{rate}} sat/vB)",
          })}
        </div>
        {/* Confirmation status */}
        <div className="text-xs" style={{ color: tooltip.tooltipData.confirmed ? SVG_COLORS.good : SVG_COLORS.medium }}>
          {tooltip.tooltipData.confirmed
            ? t("graphExplorer.confirmed", { defaultValue: "Confirmed" })
            : t("graphExplorer.unconfirmed", { defaultValue: "Unconfirmed" })}
        </div>
        {/* CoinJoin with type */}
        {tooltip.tooltipData.isCoinJoin && (
          <div className="text-xs flex items-center gap-1" style={{ color: SVG_COLORS.good }}>
            <span>&#9670;</span>
            {tooltip.tooltipData.coinJoinType ?? "CoinJoin"}
          </div>
        )}
        {/* Entity with category */}
        {tooltip.tooltipData.entityLabel && (
          <div className="text-xs space-y-0.5">
            <div className="flex items-center gap-1">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: ENTITY_CATEGORY_COLORS[tooltip.tooltipData.entityCategory ?? "unknown"] }}
              />
              <span style={{ color: ENTITY_CATEGORY_COLORS[tooltip.tooltipData.entityCategory ?? "unknown"] }}>
                {tooltip.tooltipData.entityLabel}
              </span>
            </div>
            <div style={{ color: SVG_COLORS.muted }}>
              {tooltip.tooltipData.entityCategory}
              {tooltip.tooltipData.entityConfidence && ` (${tooltip.tooltipData.entityConfidence})`}
            </div>
            {tooltip.tooltipData.entityOfac && (
              <div style={{ color: SVG_COLORS.critical }} className="font-semibold">
                OFAC Sanctioned
              </div>
            )}
          </div>
        )}
        {/* Heat map score */}
        {heatMapActive && heatMap.has(tooltip.tooltipData.txid) && (
          <div className="text-xs font-semibold" style={{ color: GRADE_HEX_SVG[heatMap.get(tooltip.tooltipData.txid)!.grade] }}>
            {t("graphExplorer.analysis.score", {
              score: heatMap.get(tooltip.tooltipData.txid)!.score,
              defaultValue: "Score: {{score}}/100",
            })} ({heatMap.get(tooltip.tooltipData.txid)!.grade})
          </div>
        )}
        <div className="text-xs" style={{ color: SVG_COLORS.muted }}>
          {t("graphExplorer.depth", { depth: tooltip.tooltipData.depth > 0 ? `+${tooltip.tooltipData.depth}` : tooltip.tooltipData.depth, defaultValue: "Depth: {{depth}}" })}
        </div>
      </div>
      )}
    </ChartTooltip>
  );

  // ─── Render ────────────────────────────────────────────

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="relative rounded-xl border border-white/5 bg-surface-inset p-4 space-y-3"
      >
        {toolbar}
        {instructions}
        {legend}

        {/* Hide inline graph when fullscreen is active to avoid double tooltip */}
        {!isExpanded && (
          <div className="relative">
            <div ref={scrollRef} className="overflow-auto max-h-[600px] -mx-4 px-4">
              <ParentSize debounceTime={100}>
                {({ width }) => width > 0 ? (
                  <GraphCanvas {...canvasProps} containerWidth={width} />
                ) : null}
              </ParentSize>
            </div>
            {tooltipContent}
            {/* Floating analysis panel - rendered outside scroll container to avoid clipping */}
            <AnimatePresence>
              {selectedNode && props.nodes.has(selectedNode.txid) && (
                <GraphNodeAnalysis
                  key={selectedNode.txid}
                  tx={props.nodes.get(selectedNode.txid)!.tx}
                  onClose={() => setSelectedNode(null)}
                  onFullScan={(txid) => {
                    setSelectedNode(null);
                    props.onTxClick?.(txid);
                  }}
                  position={{ x: selectedNode.x, y: selectedNode.y }}
                />
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Capacity warning */}
        {props.nodeCount >= props.maxNodes && (
          <div className="text-xs text-amber-400/80 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-1.5">
            {t("graphExplorer.maxNodesReached", {
              max: props.maxNodes,
              defaultValue: "Maximum number of nodes reached ({{max}}). Remove some nodes before expanding further.",
            })}
          </div>
        )}

        {/* Loading indicators */}
        {props.loading.size > 0 && (
          <div className="text-xs text-white/40 animate-pulse">
            {t("graphExplorer.fetching", { defaultValue: "Fetching transactions..." })}
          </div>
        )}

        {/* Ephemeral error messages */}
        {props.errors.size > 0 && props.loading.size === 0 && (
          <div className="text-xs text-amber-400/70">
            {[...props.errors.values()].at(-1)}
          </div>
        )}
      </motion.div>

      {/* Fullscreen modal overlay */}
      {isExpanded && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("graphExplorer.fullscreenLabel", { defaultValue: "Transaction graph fullscreen" })}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col"
          onClick={(e) => { if (e.target === e.currentTarget) collapseFullscreen(); }}
        >
          {/* Close button - always fixed top-right */}
          <button
            onClick={collapseFullscreen}
            className="fixed top-3 right-3 z-[60] text-white/60 hover:text-white transition-colors p-2 rounded-lg bg-black/60 hover:bg-surface-inset backdrop-blur-sm cursor-pointer"
            aria-label={t("common.close", { defaultValue: "Close" })}
          >
            <CloseIcon />
          </button>

          {/* Fullscreen header */}
          <div className="p-4 pr-14 space-y-2 shrink-0">
            <div className="flex flex-wrap items-center justify-between gap-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-white/70 min-w-0">
                <GraphIcon />
                <span className="truncate">{t("graphExplorer.title", { defaultValue: "Transaction Graph" })}</span>
                <span className={`text-xs font-normal hidden sm:inline ${atCapacity ? "text-amber-400" : "text-white/40"}`}>
                  {t("graphExplorer.nodeCount", { count: props.nodeCount, max: props.maxNodes, defaultValue: "({{count}}/{{max}} nodes)" })}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {/* Heat map */}
                <button
                  onClick={() => setHeatMapActive(!heatMapActive)}
                  className={`text-xs transition-colors px-2 py-1 rounded border cursor-pointer ${
                    heatMapActive ? "text-bitcoin border-bitcoin/30 bg-bitcoin/10" : "text-white/50 hover:text-white/80 border-white/10"
                  }`}
                >
                  <span className="flex items-center gap-1">
                    <HeatIcon />
                    <span className="hidden sm:inline">
                      {heatMapActive && heatProgress < 100 ? `${heatProgress}%` : t("graphExplorer.heatMap", { defaultValue: "Heat Map" })}
                    </span>
                  </span>
                </button>
                <button
                  onClick={props.onUndo}
                  disabled={!props.canUndo}
                  className={`text-xs transition-colors px-2 py-1 rounded border border-white/10 ${
                    props.canUndo
                      ? "text-white/50 hover:text-white/80 cursor-pointer"
                      : "text-white/20 cursor-not-allowed"
                  }`}
                >
                  {t("common.undo", { defaultValue: "Undo" })}
                </button>
                {props.nodeCount > 1 && (
                  <button onClick={props.onReset} className="text-xs text-white/50 hover:text-white/80 transition-colors px-2 py-1 rounded border border-white/10 cursor-pointer">
                    {t("common.reset", { defaultValue: "Reset" })}
                  </button>
                )}
                {/* Zoom controls */}
                <span className="text-white/20 hidden sm:inline">|</span>
                <button
                  onClick={() => zoomBy(1.25)}
                  className="text-xs text-white/50 hover:text-white/80 transition-colors px-1.5 py-1 rounded border border-white/10 cursor-pointer"
                  title="Zoom in"
                >+</button>
                <button
                  onClick={() => zoomBy(1 / 1.25)}
                  className="text-xs text-white/50 hover:text-white/80 transition-colors px-1.5 py-1 rounded border border-white/10 cursor-pointer"
                  title="Zoom out"
                >-</button>
                <button
                  onClick={() => {
                    const { width: gw, height: gh } = layoutGraph(props.nodes, props.rootTxid, filter, props.rootTxids);
                    const cw = window.innerWidth - 32;
                    const ch = window.innerHeight - 160;
                    setViewTransform(computeFitTransform(gw, gh, cw, ch));
                  }}
                  className="text-xs text-white/50 hover:text-white/80 transition-colors px-2 py-1 rounded border border-white/10 cursor-pointer"
                  title="Fit to view"
                >{t("graphExplorer.fit", { defaultValue: "Fit" })}</button>
              </div>
            </div>
            {instructions}
            {legend}
          </div>

          {/* Fullscreen graph area */}
          <div className="flex-1 min-h-0 relative px-4 pb-4" style={{ touchAction: "none" }}>
            <div ref={scrollRef} className="overflow-hidden h-full" style={{ touchAction: "none" }}>
              <ParentSize debounceTime={100}>
                {({ width, height: parentH }) => width > 0 ? (
                  <GraphCanvas
                    {...fullscreenCanvasProps}
                    containerWidth={width}
                    containerHeight={parentH}
                    isFullscreen
                  />
                ) : null}
              </ParentSize>
            </div>
            {tooltipContent}
            {/* Floating analysis panel in fullscreen */}
            <AnimatePresence>
              {selectedNode && props.nodes.has(selectedNode.txid) && (
                <GraphNodeAnalysis
                  key={selectedNode.txid}
                  tx={props.nodes.get(selectedNode.txid)!.tx}
                  onClose={() => setSelectedNode(null)}
                  onFullScan={(txid) => {
                    setSelectedNode(null);
                    props.onTxClick?.(txid);
                  }}
                  position={{ x: selectedNode.x, y: selectedNode.y }}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </>
  );
}
