"use client";

import { useMemo, useCallback, useRef } from "react";
import { Group } from "@visx/group";
import { Text } from "@visx/text";
import { ParentSize } from "@visx/responsive";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { SVG_COLORS } from "./shared/svgConstants";
import { ChartDefs } from "./shared/ChartDefs";
import { ChartTooltip, useChartTooltip } from "./shared/ChartTooltip";
import type { Finding } from "@/lib/types";

/**
 * Bithypha-style taint path visualization.
 *
 * Shows how taint flows through the transaction graph across multiple hops.
 * Each column represents a hop depth, nodes are transactions,
 * and edges show value flow with taint coloring.
 */

interface TaintPathDiagramProps {
  findings: Finding[];
  /** Callback when a transaction node is clicked */
  onTxClick?: (txid: string) => void;
}

interface TaintNode {
  id: string;
  label: string;
  depth: number;
  y: number;
  type: "root" | "entity" | "coinjoin" | "regular";
  taintPct: number;
  entityName?: string;
  category?: string;
  /** Address or txid to navigate to when clicked */
  clickTarget?: string;
}

interface TaintEdge {
  source: string;
  target: string;
  taintPct: number;
  value: number;
}

interface TooltipData {
  label: string;
  type: string;
  taintPct: number;
  entityName?: string;
  category?: string;
  hops?: number;
  clickTarget?: string;
}

const NODE_RADIUS = 16;
const COL_WIDTH = 140;
const ROW_HEIGHT = 60;
const MARGIN = { top: 40, right: 30, bottom: 20, left: 30 };

const TYPE_COLORS: Record<string, string> = {
  root: SVG_COLORS.bitcoin,
  entity: SVG_COLORS.high,
  coinjoin: SVG_COLORS.good,
  regular: SVG_COLORS.muted,
};

const TYPE_SHAPES: Record<string, string> = {
  root: "circle",
  entity: "square",
  coinjoin: "diamond",
  regular: "circle",
};

function buildTaintGraph(findings: Finding[]): { nodes: TaintNode[]; edges: TaintEdge[] } {
  const nodes: TaintNode[] = [];
  const edges: TaintEdge[] = [];

  // Root node (the analyzed tx)
  nodes.push({
    id: "root",
    label: "Analyzed TX",
    depth: 0,
    y: 0,
    type: "root",
    taintPct: 0,
  });

  // Extract taint data from findings
  const taintFinding = findings.find((f) => f.id === "chain-taint-backward");
  const taintPct = (taintFinding?.params?.taintPct as number) ?? 0;
  if (taintPct > 0) {
    nodes[0].taintPct = taintPct;
  }

  // Entity proximity findings - backward
  const backwardEntity = findings.find((f) => f.id === "chain-entity-proximity-backward");
  if (backwardEntity) {
    const hops = (backwardEntity.params?.hops as number) ?? 1;
    const entityName = (backwardEntity.params?.entityName as string) ?? "Unknown";
    const category = (backwardEntity.params?.category as string) ?? "unknown";
    const entityTxid = (backwardEntity.params?.entityTxid as string) ?? undefined;
    const entityAddress = (backwardEntity.params?.entityAddress as string) ?? undefined;

    // Add intermediate nodes
    for (let d = 1; d < hops; d++) {
      const nodeId = `bw-${d}`;
      nodes.push({
        id: nodeId,
        label: `Hop -${d}`,
        depth: -d,
        y: 0,
        type: "regular",
        taintPct: Math.max(0, taintPct * (1 - d / hops)),
        // Intermediate hops link to the entity's tx (closest navigable context)
        clickTarget: entityTxid,
      });
      const prevId = d === 1 ? "root" : `bw-${d - 1}`;
      edges.push({ source: nodeId, target: prevId, taintPct: 80, value: 0 });
    }

    // Add entity node - clicking navigates to entity address
    const entityNodeId = `bw-entity-${entityName}`;
    nodes.push({
      id: entityNodeId,
      label: entityName,
      depth: -hops,
      y: 0,
      type: "entity",
      taintPct: 100,
      entityName,
      category,
      clickTarget: entityAddress ?? entityTxid,
    });
    const prevId = hops === 1 ? "root" : `bw-${hops - 1}`;
    edges.push({ source: entityNodeId, target: prevId, taintPct: 100, value: 0 });
  }

  // CoinJoin in ancestry
  const cjAncestry = findings.find((f) => f.id === "chain-coinjoin-ancestry");
  if (cjAncestry) {
    const depth = backwardEntity ? -(((backwardEntity.params?.hops as number) ?? 1) + 1) : -2;
    nodes.push({
      id: "bw-coinjoin",
      label: "CoinJoin",
      depth,
      y: nodes.filter((n) => n.depth === depth).length,
      type: "coinjoin",
      taintPct: 0,
    });
  }

  // Show clean backward hops from trace summary when no entity/taint/coinjoin was found backward
  const traceSummary = findings.find((f) => f.id === "chain-trace-summary");
  if (!backwardEntity && !cjAncestry && traceSummary) {
    const bwDepth = (traceSummary.params?.backwardDepth as number) ?? 0;
    for (let d = 1; d <= bwDepth; d++) {
      const nodeId = `bw-${d}`;
      if (nodes.some((n) => n.id === nodeId)) continue;
      nodes.push({
        id: nodeId,
        label: `Hop -${d}`,
        depth: -d,
        y: 0,
        type: "regular",
        taintPct: 0,
      });
      const prevId = d === 1 ? "root" : `bw-${d - 1}`;
      edges.push({ source: nodeId, target: prevId, taintPct: 0, value: 0 });
    }
  }

  // Entity proximity findings - forward
  const forwardEntity = findings.find((f) => f.id === "chain-entity-proximity-forward");
  if (forwardEntity) {
    const hops = (forwardEntity.params?.hops as number) ?? 1;
    const entityName = (forwardEntity.params?.entityName as string) ?? "Unknown";
    const category = (forwardEntity.params?.category as string) ?? "unknown";
    const entityTxid = (forwardEntity.params?.entityTxid as string) ?? undefined;
    const entityAddress = (forwardEntity.params?.entityAddress as string) ?? undefined;

    for (let d = 1; d < hops; d++) {
      const nodeId = `fw-${d}`;
      nodes.push({
        id: nodeId,
        label: `Hop +${d}`,
        depth: d,
        y: 0,
        type: "regular",
        taintPct: Math.max(0, taintPct * (1 - d / hops)),
        clickTarget: entityTxid,
      });
      const prevId = d === 1 ? "root" : `fw-${d - 1}`;
      edges.push({ source: prevId, target: nodeId, taintPct: 60, value: 0 });
    }

    const entityNodeId = `fw-entity-${entityName}`;
    nodes.push({
      id: entityNodeId,
      label: entityName,
      depth: hops,
      y: 0,
      type: "entity",
      taintPct: 0,
      entityName,
      category,
      clickTarget: entityAddress ?? entityTxid,
    });
    const prevId = hops === 1 ? "root" : `fw-${hops - 1}`;
    edges.push({ source: prevId, target: entityNodeId, taintPct: 50, value: 0 });
  }

  // CoinJoin in descendancy
  const cjDescendancy = findings.find((f) => f.id === "chain-coinjoin-descendancy");
  if (cjDescendancy) {
    const depth = forwardEntity ? ((forwardEntity.params?.hops as number) ?? 1) + 1 : 2;
    nodes.push({
      id: "fw-coinjoin",
      label: "CoinJoin",
      depth,
      y: nodes.filter((n) => n.depth === depth).length,
      type: "coinjoin",
      taintPct: 0,
    });
  }

  // Show clean forward hops from trace summary when no entity/coinjoin was found forward
  if (!forwardEntity && !cjDescendancy && traceSummary) {
    const fwDepth = (traceSummary.params?.forwardDepth as number) ?? 0;
    for (let d = 1; d <= fwDepth; d++) {
      const nodeId = `fw-${d}`;
      if (nodes.some((n) => n.id === nodeId)) continue;
      nodes.push({
        id: nodeId,
        label: `Hop +${d}`,
        depth: d,
        y: 0,
        type: "regular",
        taintPct: 0,
      });
      const prevId = d === 1 ? "root" : `fw-${d - 1}`;
      edges.push({ source: prevId, target: nodeId, taintPct: 0, value: 0 });
    }
  }

  // Assign y positions per depth column
  const depthGroups = new Map<number, TaintNode[]>();
  for (const node of nodes) {
    const group = depthGroups.get(node.depth) ?? [];
    group.push(node);
    depthGroups.set(node.depth, group);
  }
  for (const group of depthGroups.values()) {
    group.forEach((node, i) => {
      node.y = i;
    });
  }

  return { nodes, edges };
}

function TaintPath({ width, findings, onTxClick, t, tooltip, containerRef }: { width: number; findings: Finding[]; onTxClick?: (txid: string) => void; t: (key: string, opts?: Record<string, unknown>) => string; tooltip: ReturnType<typeof useChartTooltip<TooltipData>>; containerRef: React.RefObject<HTMLDivElement | null> }) {
  const { nodes, edges } = useMemo(() => buildTaintGraph(findings), [findings]);

  const depths = nodes.map((n) => n.depth);
  const minDepth = Math.min(...depths);
  const maxDepth = Math.max(...depths);
  const cols = maxDepth - minDepth + 1;

  // Content-driven width: always give columns enough space
  const requiredWidth = cols * COL_WIDTH + MARGIN.left + MARGIN.right;
  const svgWidth = Math.max(width, requiredWidth);
  const innerWidth = svgWidth - MARGIN.left - MARGIN.right;
  const maxRows = Math.max(...[...new Set(depths)].map((d) => nodes.filter((n) => n.depth === d).length));
  const innerHeight = Math.max(maxRows * ROW_HEIGHT, 100);
  const svgHeight = innerHeight + MARGIN.top + MARGIN.bottom;

  const getX = useCallback((depth: number) => {
    const offset = depth - minDepth;
    return MARGIN.left + (offset + 0.5) * (innerWidth / cols);
  }, [minDepth, cols, innerWidth]);

  const getY = useCallback((depth: number, y: number) => {
    const group = nodes.filter((n) => n.depth === depth);
    const groupHeight = group.length * ROW_HEIGHT;
    const startY = MARGIN.top + (innerHeight - groupHeight) / 2;
    return startY + (y + 0.5) * ROW_HEIGHT;
  }, [nodes, innerHeight]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, TaintNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  if (nodes.length <= 1) return null;

  return (
    <div className="relative" style={{ position: "relative", minWidth: svgWidth }}>
      <svg width={svgWidth} height={svgHeight} className="overflow-visible">
        <ChartDefs />
        <defs>
          <linearGradient id="grad-taint-high">
            <stop offset="0%" stopColor={SVG_COLORS.critical} stopOpacity={0.8} />
            <stop offset="100%" stopColor={SVG_COLORS.high} stopOpacity={0.4} />
          </linearGradient>
          <linearGradient id="grad-taint-low">
            <stop offset="0%" stopColor={SVG_COLORS.muted} stopOpacity={0.3} />
            <stop offset="100%" stopColor={SVG_COLORS.muted} stopOpacity={0.1} />
          </linearGradient>
          <marker id="arrow-taint" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6" fill={SVG_COLORS.high} fillOpacity={0.6} />
          </marker>
        </defs>

        <Group>
          {/* Column labels */}
          {[...new Set(depths)].sort((a, b) => a - b).map((d) => (
            <Text
              key={`col-${d}`}
              x={getX(d)}
              y={MARGIN.top - 16}
              fontSize={11}
              fill={d === 0 ? SVG_COLORS.bitcoin : SVG_COLORS.muted}
              textAnchor="middle"
              fontWeight={d === 0 ? 600 : 400}
            >
              {d === 0 ? t("taintFlow.target", { defaultValue: "Target" }) : d < 0 ? `Hop ${d}` : `Hop +${d}`}
            </Text>
          ))}

          {/* Edges */}
          {edges.map((edge, i) => {
            const src = nodeMap.get(edge.source);
            const tgt = nodeMap.get(edge.target);
            if (!src || !tgt) return null;

            const x1 = getX(src.depth);
            const y1 = getY(src.depth, src.y);
            const x2 = getX(tgt.depth);
            const y2 = getY(tgt.depth, tgt.y);

            const isTainted = edge.taintPct > 50;
            const midX = (x1 + x2) / 2;

            return (
              <motion.path
                key={`edge-${i}`}
                d={`M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`}
                fill="none"
                stroke={isTainted ? SVG_COLORS.high : SVG_COLORS.muted}
                strokeWidth={isTainted ? 2.5 : 1.5}
                strokeOpacity={isTainted ? 0.7 : 0.25}
                strokeDasharray={isTainted ? undefined : "4,4"}
                markerEnd="url(#arrow-taint)"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.2 + i * 0.1 }}
              />
            );
          })}

          {/* Nodes */}
          {nodes.map((node, i) => {
            const cx = getX(node.depth);
            const cy = getY(node.depth, node.y);
            const color = TYPE_COLORS[node.type] ?? SVG_COLORS.muted;
            const shape = TYPE_SHAPES[node.type] ?? "circle";

            return (
              <motion.g
                key={node.id}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.3, delay: 0.1 + i * 0.05 }}
                style={{ cursor: node.clickTarget && onTxClick ? "pointer" : "default" }}
                onClick={() => {
                  if (node.clickTarget && onTxClick) onTxClick(node.clickTarget);
                }}
                onMouseEnter={(e: React.MouseEvent) => {
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  tooltip.showTooltip({
                    tooltipData: {
                      label: node.label,
                      type: node.type,
                      taintPct: node.taintPct,
                      entityName: node.entityName,
                      category: node.category,
                      hops: Math.abs(node.depth),
                      clickTarget: node.clickTarget,
                    },
                    tooltipLeft: e.clientX - rect.left,
                    tooltipTop: e.clientY - rect.top - 8,
                  });
                }}
                onMouseLeave={tooltip.hideTooltip}
              >
                {/* Taint ring for nodes with taint */}
                {node.taintPct > 0 && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={NODE_RADIUS + 4}
                    fill="none"
                    stroke={SVG_COLORS.critical}
                    strokeWidth={2}
                    strokeOpacity={node.taintPct / 200}
                    strokeDasharray={`${(node.taintPct / 100) * 2 * Math.PI * (NODE_RADIUS + 4)} ${2 * Math.PI * (NODE_RADIUS + 4)}`}
                  />
                )}

                {/* Node shape */}
                {shape === "circle" && (
                  <circle cx={cx} cy={cy} r={NODE_RADIUS} fill={color} fillOpacity={0.15} stroke={color} strokeWidth={2} />
                )}
                {shape === "square" && (
                  <rect
                    x={cx - NODE_RADIUS}
                    y={cy - NODE_RADIUS}
                    width={NODE_RADIUS * 2}
                    height={NODE_RADIUS * 2}
                    rx={4}
                    fill={color}
                    fillOpacity={0.15}
                    stroke={color}
                    strokeWidth={2}
                  />
                )}
                {shape === "diamond" && (
                  <polygon
                    points={`${cx},${cy - NODE_RADIUS} ${cx + NODE_RADIUS},${cy} ${cx},${cy + NODE_RADIUS} ${cx - NODE_RADIUS},${cy}`}
                    fill={color}
                    fillOpacity={0.15}
                    stroke={color}
                    strokeWidth={2}
                  />
                )}

                {/* Node label */}
                <Text
                  x={cx}
                  y={cy + NODE_RADIUS + 14}
                  fontSize={10}
                  fill={SVG_COLORS.muted}
                  textAnchor="middle"
                  width={COL_WIDTH - 20}
                >
                  {(() => {
                  const label = node.label === "Analyzed TX"
                    ? t("taintFlow.analyzedTx", { defaultValue: "Analyzed TX" })
                    : node.label;
                  return label.length > 16 ? label.slice(0, 14) + "..." : label;
                })()}
                </Text>

                {/* Category badge for entities */}
                {node.category && (
                  <Text
                    x={cx}
                    y={cy + NODE_RADIUS + 26}
                    fontSize={9}
                    fill={SVG_COLORS.high}
                    textAnchor="middle"
                    fontStyle="italic"
                  >
                    {node.category}
                  </Text>
                )}
              </motion.g>
            );
          })}
        </Group>
      </svg>
    </div>
  );
}

export function TaintPathDiagram({ findings, onTxClick }: TaintPathDiagramProps) {
  const { t } = useTranslation();
  const tooltip = useChartTooltip<TooltipData>();
  const containerRef = useRef<HTMLDivElement>(null);

  // Only render if we have relevant chain analysis findings
  const hasChainData = findings.some((f) =>
    f.id === "chain-taint-backward" ||
    f.id === "chain-entity-proximity-backward" ||
    f.id === "chain-entity-proximity-forward" ||
    f.id === "chain-coinjoin-ancestry" ||
    f.id === "chain-coinjoin-descendancy" ||
    f.id === "chain-trace-summary"
  );

  if (!hasChainData) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
      className="rounded-xl border border-white/5 bg-surface-inset p-4 space-y-3"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-white/70">
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
          <path d="M1 8h14M4 4l-3 4 3 4M12 4l3 4-3 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t("taintFlow.title", { defaultValue: "Taint Flow" })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-white/50">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full border-2" style={{ borderColor: SVG_COLORS.bitcoin, background: `${SVG_COLORS.bitcoin}22` }} />
          {t("taintFlow.targetTx", { defaultValue: "Target TX" })}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded border-2" style={{ borderColor: SVG_COLORS.high, background: `${SVG_COLORS.high}22` }} />
          {t("taintFlow.knownEntity", { defaultValue: "Known Entity" })}
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <polygon points="6,0 12,6 6,12 0,6" fill={`${SVG_COLORS.good}22`} stroke={SVG_COLORS.good} strokeWidth="1.5" />
          </svg>
          CoinJoin
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-6 border-t-2" style={{ borderColor: SVG_COLORS.high }} />
          {t("taintFlow.taintedPath", { defaultValue: "Tainted path" })}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-6 border-t-2 border-dashed" style={{ borderColor: SVG_COLORS.muted }} />
          {t("taintFlow.cleanPath", { defaultValue: "Clean path" })}
        </span>
      </div>

      <div className="relative" ref={containerRef}>
        <div className="overflow-x-auto -mx-4 px-4">
          <ParentSize debounceTime={100}>
            {({ width }) => width > 0 ? <TaintPath width={Math.max(width, 400)} findings={findings} onTxClick={onTxClick} t={t} tooltip={tooltip} containerRef={containerRef} /> : null}
          </ParentSize>
        </div>

        {/* Tooltip rendered outside the scroll container to prevent clipping */}
        {tooltip.tooltipOpen && tooltip.tooltipData && (
          <ChartTooltip top={tooltip.tooltipTop} left={tooltip.tooltipLeft}>
            <div className="space-y-1">
              <div className="font-medium">{tooltip.tooltipData.label}</div>
              {tooltip.tooltipData.entityName && (
                <div className="text-xs" style={{ color: SVG_COLORS.high }}>
                  {tooltip.tooltipData.entityName} ({tooltip.tooltipData.category})
                </div>
              )}
              {tooltip.tooltipData.hops !== undefined && tooltip.tooltipData.hops > 0 && (
                <div className="text-xs" style={{ color: SVG_COLORS.muted }}>
                  {t("taintFlow.hopsFromTarget", { count: tooltip.tooltipData.hops, defaultValue: "{{count}} hop from target" })}
                </div>
              )}
              {tooltip.tooltipData.taintPct > 0 && (
                <div className="text-xs" style={{ color: SVG_COLORS.critical }}>
                  {t("taintFlow.taintPct", { pct: tooltip.tooltipData.taintPct, defaultValue: "Taint: {{pct}}%" })}
                </div>
              )}
              {tooltip.tooltipData.clickTarget && (
                <div className="text-xs" style={{ color: SVG_COLORS.bitcoin }}>
                  {t("taintFlow.clickToAnalyze", { defaultValue: "Click to analyze" })}
                </div>
              )}
            </div>
          </ChartTooltip>
        )}
      </div>
    </motion.div>
  );
}
