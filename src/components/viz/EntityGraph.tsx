"use client";

import { useMemo, useCallback } from "react";
import { Group } from "@visx/group";
import { Graph } from "@visx/network";
import { ParentSize } from "@visx/responsive";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/hooks/useTheme";
import { SVG_COLORS } from "./shared/svgConstants";
import { truncateId } from "@/lib/constants";
import type { ClusterResult, ClusterEdge } from "@/lib/analysis/cluster/build-cluster";

interface EntityGraphProps {
  result: ClusterResult;
  targetAddress: string;
  onAddressClick?: (address: string) => void;
}

interface GraphNode {
  x: number;
  y: number;
  address: string;
  isTarget: boolean;
}

interface GraphLink {
  source: GraphNode;
  target: GraphNode;
  edge: ClusterEdge;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

const NODE_RADIUS = 8;
const TARGET_RADIUS = 12;
const MARGIN = 40;
const MAX_DISPLAY_NODES = 40;

function layoutGraph(
  result: ClusterResult,
  targetAddress: string,
  width: number,
  height: number,
): GraphData {
  const addresses = result.addresses.slice(0, MAX_DISPLAY_NODES);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(cx, cy) - MARGIN;

  // Place target at center, others in concentric rings
  const nodeMap = new Map<string, GraphNode>();

  // Target node at center
  const targetNode: GraphNode = { x: cx, y: cy, address: targetAddress, isTarget: true };
  nodeMap.set(targetAddress, targetNode);

  // Sort non-target addresses: direct connections first
  const directlyConnected = new Set<string>();
  for (const edge of result.edges) {
    if (edge.source === targetAddress) directlyConnected.add(edge.target);
    if (edge.target === targetAddress) directlyConnected.add(edge.source);
  }

  const otherAddrs = addresses.filter((a) => a !== targetAddress);
  const direct = otherAddrs.filter((a) => directlyConnected.has(a));
  const indirect = otherAddrs.filter((a) => !directlyConnected.has(a));

  // Layout direct connections in inner ring
  const innerRadius = Math.min(radius * 0.5, 120);
  direct.forEach((addr, i) => {
    const angle = (2 * Math.PI * i) / Math.max(direct.length, 1) - Math.PI / 2;
    nodeMap.set(addr, {
      x: cx + innerRadius * Math.cos(angle),
      y: cy + innerRadius * Math.sin(angle),
      address: addr,
      isTarget: false,
    });
  });

  // Layout indirect connections in outer ring
  const outerRadius = Math.min(radius * 0.85, 200);
  indirect.forEach((addr, i) => {
    const angle = (2 * Math.PI * i) / Math.max(indirect.length, 1) - Math.PI / 4;
    nodeMap.set(addr, {
      x: cx + outerRadius * Math.cos(angle),
      y: cy + outerRadius * Math.sin(angle),
      address: addr,
      isTarget: false,
    });
  });

  const nodes = [...nodeMap.values()];

  // Build links from edges
  const links: GraphLink[] = [];
  for (const edge of result.edges) {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    if (sourceNode && targetNode) {
      links.push({ source: sourceNode, target: targetNode, edge });
    }
  }

  return { nodes, links };
}

function EntityGraphChart({
  width,
  height,
  result,
  targetAddress,
  onAddressClick,
}: EntityGraphProps & { width: number; height: number }) {
  const { t } = useTranslation();
  const graph = useMemo(
    () => layoutGraph(result, targetAddress, width, height),
    [result, targetAddress, width, height],
  );

  const handleClick = useCallback(
    (addr: string) => {
      if (onAddressClick) onAddressClick(addr);
    },
    [onAddressClick],
  );

  const handleKeyDown = useCallback(
    (addr: string, e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleClick(addr);
      }
    },
    [handleClick],
  );

  if (width < 100 || height < 100) return null;

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={t("cluster.graphAria", { defaultValue: "Entity cluster graph" })}
    >
      <rect width={width} height={height} rx={12} fill={SVG_COLORS.surfaceInset} />
      <Graph<GraphLink, GraphNode>
        graph={graph}
        nodeComponent={({ node }) => {
          const r = node.isTarget ? TARGET_RADIUS : NODE_RADIUS;
          const fill = node.isTarget
            ? SVG_COLORS.bitcoin
            : SVG_COLORS.low;
          const truncated = truncateId(node.address, 6);
          const interactive = !!onAddressClick;

          return (
            <Group>
              <circle
                r={r}
                fill={fill}
                stroke={node.isTarget ? SVG_COLORS.bitcoinHover : SVG_COLORS.cardBorder}
                strokeWidth={node.isTarget ? 2.5 : 1.5}
                opacity={0.9}
                style={{ cursor: interactive ? "pointer" : "default" }}
                onClick={() => handleClick(node.address)}
                onKeyDown={(e) => handleKeyDown(node.address, e)}
                tabIndex={interactive ? 0 : undefined}
                role={interactive ? "button" : undefined}
                aria-label={truncated}
              >
                <title>{node.address}</title>
              </circle>
              <text
                dy={r + 12}
                textAnchor="middle"
                fill={node.isTarget ? SVG_COLORS.bitcoin : SVG_COLORS.muted}
                fontSize={9}
                fontFamily="monospace"
                style={{ cursor: interactive ? "pointer" : "default" }}
                onClick={() => handleClick(node.address)}
              >
                {truncated}
              </text>
            </Group>
          );
        }}
        linkComponent={({ link }) => (
          <line
            x1={link.source.x}
            y1={link.source.y}
            x2={link.target.x}
            y2={link.target.y}
            stroke={link.edge.txid === "change"
              ? SVG_COLORS.medium
              : SVG_COLORS.cardBorder}
            strokeWidth={link.edge.txid === "change" ? 1.5 : 1}
            strokeDasharray={link.edge.txid === "change" ? "4,3" : undefined}
            opacity={0.5}
          />
        )}
      />
    </svg>
  );
}

export function EntityGraph(props: EntityGraphProps) {
  const { t } = useTranslation();
  useTheme(); // re-render on theme change for SVG_COLORS

  if (props.result.size < 2 || props.result.edges.length === 0) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-muted uppercase tracking-wider">
        {t("cluster.graphTitle", { defaultValue: "Entity graph" })}
      </h4>
      <div style={{ height: 300 }} className="w-full">
        <ParentSize>
          {({ width, height }) => (
            <EntityGraphChart width={width} height={height} {...props} />
          )}
        </ParentSize>
      </div>
      <div className="flex flex-wrap gap-3 text-[10px] text-muted">
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SVG_COLORS.bitcoin }} />
          {t("cluster.graphTarget", { defaultValue: "Target address" })}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SVG_COLORS.low }} />
          {t("cluster.graphLinked", { defaultValue: "Co-input address" })}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-4 h-0 border-t border-dashed" style={{ borderColor: SVG_COLORS.medium }} />
          {t("cluster.graphChange", { defaultValue: "Change output" })}
        </span>
      </div>
      {props.result.size > MAX_DISPLAY_NODES && (
        <p className="text-[10px] text-muted">
          {t("cluster.graphTruncated", {
            shown: MAX_DISPLAY_NODES,
            total: props.result.size,
            defaultValue: "Showing {{shown}} of {{total}} addresses",
          })}
        </p>
      )}
    </div>
  );
}
