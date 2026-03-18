"use client";

import { useMemo, memo } from "react";
import { motion } from "motion/react";
import { Text } from "@visx/text";
import { SVG_COLORS } from "../shared/svgConstants";
import { formatSats } from "@/lib/format";
import { truncateId } from "@/lib/constants";
import { PORT_H, PORT_COL_W, MAX_VISIBLE_PORTS, EXPANDED_HEADER_H, EXPANDED_PAD_V } from "./constants";
import { buildInputPorts, buildOutputPorts } from "./portLayout";
import { getNodeColor } from "./layout";
import { getScriptTypeColor } from "./scriptStyles";
import type { LayoutNode, PortLayout, GraphNode } from "./types";
import type { MempoolOutspend } from "@/lib/api/types";

interface ExpandedNodeProps {
  node: LayoutNode;
  graphNodes: Map<string, GraphNode>;
  outspends?: MempoolOutspend[];
  heatScore?: number;
  isLoading: boolean;
  hoveredPort: string | null;
  onHoverPort: (portKey: string | null) => void;
  onExpandInput: (txid: string, inputIndex: number) => void;
  onExpandOutput: (txid: string, outputIndex: number) => void;
  onNodeClick: () => void;
  atCapacity: boolean;
}

function PortRow({
  port,
  side,
  x,
  nodeWidth,
  hoveredPort,
  portKey,
  onHover,
  onClick,
  canExpand,
}: {
  port: PortLayout;
  side: "input" | "output";
  x: number;
  nodeWidth: number;
  hoveredPort: string | null;
  portKey: string;
  onHover: (key: string | null) => void;
  onClick: () => void;
  canExpand: boolean;
}) {
  const portX = side === "input" ? x + 2 : x + nodeWidth - PORT_COL_W - 2;
  const portY = port.y - PORT_H / 2;
  const typeColor = getScriptTypeColor(port.scriptType);
  const isHovered = hoveredPort === portKey;
  const addr = port.address === "coinbase" ? "coinbase" : truncateId(port.address, 4);
  const isUnspent = side === "output" && port.spent === false;
  const isOpReturn = port.scriptType === "op_return";

  return (
    <g
      style={{ cursor: canExpand ? "pointer" : "default" }}
      onMouseEnter={() => onHover(portKey)}
      onMouseLeave={() => onHover(null)}
      onClick={(e) => {
        if (canExpand) {
          e.stopPropagation();
          onClick();
        }
      }}
    >
      {/* Port background */}
      <rect
        x={portX}
        y={portY}
        width={PORT_COL_W}
        height={PORT_H}
        rx={3}
        fill={isHovered ? "var(--subtle-border)" : "var(--subtle-hover)"}
        stroke={isHovered ? typeColor : "var(--subtle-border)"}
        strokeWidth={isHovered ? 1 : 0.5}
      />

      {/* Script type color strip */}
      <rect
        x={side === "input" ? portX : portX + PORT_COL_W - 3}
        y={portY}
        width={3}
        height={PORT_H}
        rx={side === "input" ? 3 : 0}
        fill={typeColor}
        fillOpacity={0.7}
      />

      {/* Address */}
      <Text
        x={portX + (side === "input" ? 8 : 6)}
        y={port.y - 6}
        fontSize={9}
        fill={isOpReturn ? SVG_COLORS.medium : SVG_COLORS.muted}
        fontFamily="monospace"
      >
        {addr}
      </Text>

      {/* Value */}
      <Text
        x={portX + (side === "input" ? 8 : 6)}
        y={port.y + 11}
        fontSize={9}
        fill={SVG_COLORS.bitcoin}
        fillOpacity={isOpReturn ? 0.4 : 0.8}
      >
        {formatSats(port.value)}
      </Text>

      {/* Unspent diamond (outputs only) */}
      {isUnspent && (
        <g transform={`translate(${portX + PORT_COL_W - 10}, ${port.y})`}>
          <polygon
            points="0,-4 4,0 0,4 -4,0"
            fill="none"
            stroke={typeColor}
            strokeWidth={1}
            strokeOpacity={0.8}
          />
        </g>
      )}

      {/* Expand indicator dot */}
      {canExpand && (
        <circle
          cx={side === "input" ? portX - 5 : portX + PORT_COL_W + 5}
          cy={port.y}
          r={4}
          fill={isHovered ? typeColor : SVG_COLORS.surfaceElevated}
          stroke={typeColor}
          strokeWidth={1}
          strokeOpacity={isHovered ? 1 : 0.5}
        />
      )}

      {/* Already-expanded indicator (small check) */}
      {port.isExpanded && (
        <circle
          cx={side === "input" ? portX - 5 : portX + PORT_COL_W + 5}
          cy={port.y}
          r={3}
          fill={typeColor}
          fillOpacity={0.4}
        />
      )}
    </g>
  );
}

export const ExpandedNode = memo(function ExpandedNode({
  node,
  graphNodes,
  outspends,
  heatScore,
  isLoading,
  hoveredPort,
  onHoverPort,
  onExpandInput,
  onExpandOutput,
  onNodeClick,
  atCapacity,
}: ExpandedNodeProps) {
  const color = getNodeColor(node, heatScore);
  const totalValue = node.tx.vout.reduce((s, o) => s + o.value, 0);

  const inputPorts = useMemo(
    () => buildInputPorts(node.tx, node.y, node.height, graphNodes),
    [node.tx, node.y, node.height, graphNodes],
  );

  const outputPorts = useMemo(
    () => buildOutputPorts(node.tx, node.y, node.height, graphNodes, outspends),
    [node.tx, node.y, node.height, graphNodes, outspends],
  );

  const overflowInputs = node.tx.vin.length - MAX_VISIBLE_PORTS;
  const overflowOutputs = node.tx.vout.length - MAX_VISIBLE_PORTS;

  return (
    <g style={{ cursor: "pointer" }}>
      {/* Node background */}
      <rect
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        rx={8}
        fill={SVG_COLORS.surfaceElevated}
        stroke={color}
        strokeWidth={2.5}
        strokeOpacity={1}
        filter="url(#glow-medium)"
        onClick={onNodeClick}
      />

      {/* Loading pulse */}
      {isLoading && (
        <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={8} fill={color} fillOpacity={0.15}>
          <animate attributeName="fill-opacity" values="0.05;0.2;0.05" dur="1.2s" repeatCount="indefinite" />
        </rect>
      )}

      {/* Header section */}
      <Text
        x={node.x + node.width / 2}
        y={node.y + 16}
        fontSize={10}
        fill={color}
        fontWeight={600}
        fontFamily="monospace"
        textAnchor="middle"
      >
        {truncateId(node.txid, 10)}
      </Text>
      <Text
        x={node.x + node.width / 2}
        y={node.y + 30}
        fontSize={9}
        fill={SVG_COLORS.muted}
        textAnchor="middle"
      >
        {`${node.inputCount}in / ${node.outputCount}out - ${formatSats(totalValue)}`}
      </Text>

      {/* Separator line under header */}
      <line
        x1={node.x + 8}
        y1={node.y + EXPANDED_HEADER_H - 2}
        x2={node.x + node.width - 8}
        y2={node.y + EXPANDED_HEADER_H - 2}
        stroke="var(--subtle-border)"
        strokeWidth={0.5}
      />

      {/* Input ports (left side) - staggered entry */}
      {inputPorts.map((port, pi) => {
        const portKey = `${node.txid}:input:${port.index}`;
        return (
          <motion.g
            key={portKey}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: pi * 0.03, duration: 0.2 }}
          >
            <PortRow
              port={port}
              side="input"
              x={node.x}
              nodeWidth={node.width}
              hoveredPort={hoveredPort}
              portKey={portKey}
              onHover={onHoverPort}
              onClick={() => onExpandInput(node.txid, port.index)}
              canExpand={port.isExpandable && !atCapacity}
            />
          </motion.g>
        );
      })}

      {/* Output ports (right side) - staggered entry */}
      {outputPorts.map((port, pi) => {
        const portKey = `${node.txid}:output:${port.index}`;
        return (
          <motion.g
            key={portKey}
            initial={{ opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: pi * 0.03, duration: 0.2 }}
          >
            <PortRow
              port={port}
              side="output"
              x={node.x}
              nodeWidth={node.width}
              hoveredPort={hoveredPort}
              portKey={portKey}
              onHover={onHoverPort}
              onClick={() => onExpandOutput(node.txid, port.index)}
              canExpand={port.isExpandable && !atCapacity}
            />
          </motion.g>
        );
      })}

      {/* Overflow indicators */}
      {overflowInputs > 0 && (
        <Text
          x={node.x + PORT_COL_W / 2 + 2}
          y={node.y + node.height - EXPANDED_PAD_V}
          fontSize={8}
          fill={SVG_COLORS.muted}
          fillOpacity={0.6}
          textAnchor="middle"
        >
          {`... +${overflowInputs} more`}
        </Text>
      )}
      {overflowOutputs > 0 && (
        <Text
          x={node.x + node.width - PORT_COL_W / 2 - 2}
          y={node.y + node.height - EXPANDED_PAD_V}
          fontSize={8}
          fill={SVG_COLORS.muted}
          fillOpacity={0.6}
          textAnchor="middle"
        >
          {`... +${overflowOutputs} more`}
        </Text>
      )}

      {/* Transparent click overlay for the header/center area */}
      <rect
        x={node.x}
        y={node.y}
        width={node.width}
        height={EXPANDED_HEADER_H}
        rx={8}
        fill="transparent"
        style={{ cursor: "pointer" }}
        onClick={onNodeClick}
      />
    </g>
  );
});
