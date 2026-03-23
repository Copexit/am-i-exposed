"use client";

import { useMemo, memo } from "react";
import { motion } from "motion/react";
import { Text } from "@visx/text";
import { useTranslation } from "react-i18next";
import { SVG_COLORS } from "../shared/svgConstants";
import { formatSats } from "@/lib/format";
import { truncateId } from "@/lib/constants";
import { PORT_COL_W, MAX_VISIBLE_PORTS, EXPANDED_HEADER_H, EXPANDED_PAD_V } from "./constants";
import { buildInputPorts, buildOutputPorts } from "./portLayout";
import { getNodeColor } from "./layout";
import { PortRow } from "./PortRow";
import type { LayoutNode, GraphNode } from "./types";
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
  onMouseDown?: (e: React.MouseEvent) => void;
  onTouchStart?: (e: React.TouchEvent) => void;
  atCapacity: boolean;
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
  onMouseDown,
  onTouchStart,
  atCapacity,
}: ExpandedNodeProps) {
  const { t } = useTranslation();
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
    <g style={{ cursor: onMouseDown ? "grab" : "pointer" }}>
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
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
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
          {t("graph.overflowMore", { count: overflowInputs, defaultValue: "... +{{count}} more" })}
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
          {t("graph.overflowMore", { count: overflowOutputs, defaultValue: "... +{{count}} more" })}
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
