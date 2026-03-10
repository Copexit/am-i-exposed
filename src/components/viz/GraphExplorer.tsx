"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import { Text } from "@visx/text";
import { ParentSize } from "@visx/responsive";
import { useTranslation } from "react-i18next";
import { SVG_COLORS } from "./shared/svgConstants";
import { ChartDefs } from "./shared/ChartDefs";
import { ChartTooltip, useChartTooltip } from "./shared/ChartTooltip";
import { formatSats } from "@/lib/format";
import { truncateId } from "@/lib/constants";
import { matchEntitySync } from "@/lib/analysis/entity-filter/entity-match";
import { analyzeCoinJoin, isCoinJoinFinding } from "@/lib/analysis/heuristics/coinjoin";
import type { GraphNode } from "@/hooks/useGraphExpansion";
import type { MempoolTransaction } from "@/lib/api/types";
import type { Finding } from "@/lib/types";

/**
 * OXT-style interactive graph explorer.
 *
 * Renders an expandable transaction DAG where each node represents a transaction.
 * Users can click inputs (left side) to expand backward or outputs (right side)
 * to expand forward. Nodes are colored by privacy grade and entity attribution.
 */

interface GraphExplorerProps {
  nodes: Map<string, GraphNode>;
  rootTxid: string;
  findings?: Finding[];
  loading: Set<string>;
  nodeCount: number;
  maxNodes: number;
  canUndo: boolean;
  onExpandInput: (txid: string, inputIndex: number) => void;
  onExpandOutput: (txid: string, outputIndex: number) => void;
  onCollapse: (txid: string) => void;
  onUndo: () => void;
  onReset: () => void;
  onTxClick?: (txid: string) => void;
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
  entityLabel?: string;
  inputCount: number;
  outputCount: number;
}

interface LayoutEdge {
  fromTxid: string;
  toTxid: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface TooltipData {
  txid: string;
  inputCount: number;
  outputCount: number;
  totalValue: number;
  isCoinJoin: boolean;
  entityLabel?: string;
  depth: number;
}

const NODE_W = 180;
const NODE_H = 56;
const COL_GAP = 100;
const ROW_GAP = 24;
const MARGIN = { top: 50, right: 40, bottom: 20, left: 40 };

function layoutGraph(
  graphNodes: Map<string, GraphNode>,
  rootTxid: string,
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

    group.forEach((node, i) => {
      const y = startY + i * (NODE_H + ROW_GAP);
      nodePositions.set(node.txid, { x, y });

      const isCJ = analyzeCoinJoin(node.tx).findings.some(isCoinJoinFinding);
      const entityMatch = node.tx.vout
        .map((o) => o.scriptpubkey_address ? matchEntitySync(o.scriptpubkey_address) : null)
        .find((m) => m !== null) ?? null;

      layoutNodes.push({
        txid: node.txid,
        tx: node.tx,
        x,
        y,
        width: NODE_W,
        height: NODE_H,
        depth: node.depth,
        isRoot: node.txid === rootTxid,
        isCoinJoin: isCJ,
        entityLabel: entityMatch?.entityName,
        inputCount: node.tx.vin.length,
        outputCount: node.tx.vout.length,
      });
    });
  }

  // Build edges from parent/child relationships
  for (const [, node] of graphNodes) {
    if (node.parentEdge) {
      const fromPos = nodePositions.get(node.parentEdge.fromTxid);
      const toPos = nodePositions.get(node.txid);
      if (fromPos && toPos) {
        edges.push({
          fromTxid: node.parentEdge.fromTxid,
          toTxid: node.txid,
          x1: fromPos.x + NODE_W,
          y1: fromPos.y + NODE_H / 2,
          x2: toPos.x,
          y2: toPos.y + NODE_H / 2,
        });
      }
    }
    if (node.childEdge) {
      const fromPos = nodePositions.get(node.txid);
      const toPos = nodePositions.get(node.childEdge.toTxid);
      if (fromPos && toPos) {
        edges.push({
          fromTxid: node.txid,
          toTxid: node.childEdge.toTxid,
          x1: fromPos.x + NODE_W,
          y1: fromPos.y + NODE_H / 2,
          x2: toPos.x,
          y2: toPos.y + NODE_H / 2,
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

function getNodeColor(node: LayoutNode): string {
  if (node.isRoot) return SVG_COLORS.bitcoin;
  if (node.isCoinJoin) return SVG_COLORS.good;
  if (node.entityLabel) return SVG_COLORS.high;
  return SVG_COLORS.low;
}

interface GraphCanvasProps extends GraphExplorerProps {
  containerWidth: number;
  tooltip: ReturnType<typeof useChartTooltip<TooltipData>>;
}

function GraphCanvas({
  nodes,
  rootTxid,
  onExpandInput,
  onExpandOutput,
  onCollapse,
  onTxClick,
  containerWidth,
  tooltip,
}: GraphCanvasProps) {
  const { layoutNodes, edges, width, height } = useMemo(
    () => layoutGraph(nodes, rootTxid),
    [nodes, rootTxid],
  );

  const svgWidth = Math.max(containerWidth, width);
  const svgHeight = Math.max(height, 150);

  return (
    <div className="relative" style={{ minWidth: svgWidth }}>
      <svg width={svgWidth} height={svgHeight} className="overflow-visible">
        <ChartDefs />
        <defs>
          <marker id="arrow-graph" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6" fill={SVG_COLORS.muted} fillOpacity={0.5} />
          </marker>
        </defs>

        {/* Edges */}
        {edges.map((edge) => {
          const midX = (edge.x1 + edge.x2) / 2;
          return (
            <motion.path
              key={`e-${edge.fromTxid}-${edge.toTxid}`}
              d={`M${edge.x1},${edge.y1} C${midX},${edge.y1} ${midX},${edge.y2} ${edge.x2},${edge.y2}`}
              fill="none"
              stroke={SVG_COLORS.muted}
              strokeWidth={1.5}
              strokeOpacity={0.35}
              markerEnd="url(#arrow-graph)"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.4 }}
            />
          );
        })}

        {/* Nodes */}
        {layoutNodes.map((node) => {
          const color = getNodeColor(node);
          const totalValue = node.tx.vout.reduce((s, o) => s + o.value, 0);
          return (
            <motion.g
              key={node.txid}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
              onMouseEnter={() => {
                tooltip.showTooltip({
                  tooltipData: {
                    txid: node.txid,
                    inputCount: node.inputCount,
                    outputCount: node.outputCount,
                    totalValue,
                    isCoinJoin: node.isCoinJoin,
                    entityLabel: node.entityLabel,
                    depth: node.depth,
                  },
                  tooltipLeft: node.x + node.width / 2,
                  tooltipTop: node.y - 8,
                });
              }}
              onMouseLeave={tooltip.hideTooltip}
            >
              {/* Node background */}
              <rect
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                rx={8}
                fill={SVG_COLORS.surfaceElevated}
                stroke={color}
                strokeWidth={node.isRoot ? 2.5 : 1.5}
                strokeOpacity={node.isRoot ? 1 : 0.6}
                style={{ cursor: onTxClick ? "pointer" : "default" }}
                onClick={() => onTxClick?.(node.txid)}
              />

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

              {/* Txid label */}
              <Text
                x={node.x + 10}
                y={node.y + 20}
                fontSize={11}
                fill={color}
                fontWeight={600}
                fontFamily="monospace"
              >
                {truncateId(node.txid, 16)}
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

              {/* Entity label */}
              {node.entityLabel && (
                <Text
                  x={node.x + 10}
                  y={node.y + 50}
                  fontSize={9}
                  fill={SVG_COLORS.high}
                  fontStyle="italic"
                >
                  {node.entityLabel}
                </Text>
              )}

              {/* Expand left button (backward) */}
              {!node.isRoot && node.depth <= 0 && (
                <g style={{ cursor: "pointer" }} onClick={() => {
                  // Expand first non-coinbase input
                  const idx = node.tx.vin.findIndex((v) => !v.is_coinbase);
                  if (idx >= 0) onExpandInput(node.txid, idx);
                }}>
                  <circle cx={node.x - 4} cy={node.y + NODE_H / 2} r={8} fill={SVG_COLORS.surfaceElevated} stroke={color} strokeWidth={1} />
                  <Text x={node.x - 4} y={node.y + NODE_H / 2 + 4} fontSize={12} textAnchor="middle" fill={color}>+</Text>
                </g>
              )}

              {/* Expand right button (forward) */}
              {node.depth >= 0 && (
                <g style={{ cursor: "pointer" }} onClick={() => {
                  // Expand first output
                  onExpandOutput(node.txid, 0);
                }}>
                  <circle cx={node.x + node.width + 4} cy={node.y + NODE_H / 2} r={8} fill={SVG_COLORS.surfaceElevated} stroke={color} strokeWidth={1} />
                  <Text x={node.x + node.width + 4} y={node.y + NODE_H / 2 + 4} fontSize={12} textAnchor="middle" fill={color}>+</Text>
                </g>
              )}

              {/* Collapse button for non-root nodes */}
              {!node.isRoot && (
                <g style={{ cursor: "pointer" }} onClick={() => onCollapse(node.txid)}>
                  <circle cx={node.x + node.width - 8} cy={node.y + NODE_H - 8} r={6} fill={SVG_COLORS.surfaceInset} stroke={SVG_COLORS.muted} strokeWidth={0.5} />
                  <Text x={node.x + node.width - 8} y={node.y + NODE_H - 5} fontSize={9} textAnchor="middle" fill={SVG_COLORS.muted}>x</Text>
                </g>
              )}
            </motion.g>
          );
        })}
      </svg>

    </div>
  );
}

export function GraphExplorer(props: GraphExplorerProps) {
  const { t } = useTranslation();
  const tooltip = useChartTooltip<TooltipData>();

  if (props.nodes.size === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="relative rounded-xl border border-white/5 bg-surface-inset p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-white/70">
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
            <circle cx="4" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="12" cy="4" r="2" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.5" />
            <path d="M6 7l4-2M6 9l4 2" stroke="currentColor" strokeWidth="1" strokeOpacity="0.5" />
          </svg>
          {t("graphExplorer.title", { defaultValue: "Transaction Graph" })}
          <span className="text-xs text-white/40 font-normal">
            {t("graphExplorer.nodeCount", { count: props.nodeCount, max: props.maxNodes, defaultValue: "({{count}}/{{max}} nodes)" })}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {props.canUndo && (
            <button
              onClick={props.onUndo}
              className="text-xs text-white/50 hover:text-white/80 transition-colors px-2 py-1 rounded border border-white/10 cursor-pointer"
            >
              {t("common.undo", { defaultValue: "Undo" })}
            </button>
          )}
          {props.nodeCount > 1 && (
            <button
              onClick={props.onReset}
              className="text-xs text-white/50 hover:text-white/80 transition-colors px-2 py-1 rounded border border-white/10 cursor-pointer"
            >
              {t("common.reset", { defaultValue: "Reset" })}
            </button>
          )}
        </div>
      </div>

      <div className="text-xs text-white/40">
        {t("graphExplorer.instructions", { defaultValue: "Click + buttons on nodes to expand the graph. Click node to analyze." })}
      </div>

      <div className="relative">
        <div className="overflow-x-auto -mx-4 px-4">
          <ParentSize debounceTime={100}>
            {({ width }) => width > 0 ? (
              <GraphCanvas {...props} containerWidth={width} tooltip={tooltip} />
            ) : null}
          </ParentSize>
        </div>

        {/* Tooltip rendered outside the scroll container but inside relative wrapper */}
        {tooltip.tooltipOpen && tooltip.tooltipData && (
          <ChartTooltip top={tooltip.tooltipTop} left={tooltip.tooltipLeft}>
            <div className="space-y-1">
              <div className="font-mono text-xs">{truncateId(tooltip.tooltipData.txid, 24)}</div>
              <div className="text-xs" style={{ color: SVG_COLORS.muted }}>
                {tooltip.tooltipData.inputCount} {t("graphExplorer.inputs", { defaultValue: "inputs" })}, {tooltip.tooltipData.outputCount} {t("graphExplorer.outputs", { defaultValue: "outputs" })}
              </div>
              <div className="text-xs" style={{ color: SVG_COLORS.bitcoin }}>
                {formatSats(tooltip.tooltipData.totalValue)}
              </div>
              {tooltip.tooltipData.isCoinJoin && (
                <div className="text-xs" style={{ color: SVG_COLORS.good }}>CoinJoin</div>
              )}
              {tooltip.tooltipData.entityLabel && (
                <div className="text-xs" style={{ color: SVG_COLORS.high }}>{tooltip.tooltipData.entityLabel}</div>
              )}
              <div className="text-xs" style={{ color: SVG_COLORS.muted }}>
                {t("graphExplorer.depth", { depth: tooltip.tooltipData.depth > 0 ? `+${tooltip.tooltipData.depth}` : tooltip.tooltipData.depth, defaultValue: "Depth: {{depth}}" })}
              </div>
            </div>
          </ChartTooltip>
        )}
      </div>

      {/* Loading indicators */}
      {props.loading.size > 0 && (
        <div className="text-xs text-white/40 animate-pulse">
          {t("graphExplorer.fetching", { defaultValue: "Fetching transactions..." })}
        </div>
      )}
    </motion.div>
  );
}
