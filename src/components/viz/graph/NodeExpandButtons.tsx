"use client";

import { Text } from "@visx/text";
import { SVG_COLORS } from "../shared/svgConstants";
import type { LayoutNode, GraphNode } from "./types";
import type { MempoolOutspend } from "@/lib/api/types";

interface NodeExpandButtonsProps {
  node: LayoutNode;
  graphNodes: Map<string, GraphNode>;
  color: string;
  atCapacity: boolean;
  outspendCache?: ReadonlyMap<string, MempoolOutspend[]>;
  onExpandInput: (txid: string, inputIndex: number) => void;
  onExpandOutput: (txid: string, outputIndex: number) => void;
  onCollapse: (txid: string) => void;
}

export function NodeExpandButtons({
  node,
  graphNodes,
  color,
  atCapacity,
  outspendCache,
  onExpandInput,
  onExpandOutput,
  onCollapse,
}: NodeExpandButtonsProps) {
  return (
    <>
      {/* Expand left button (backward) */}
      {!atCapacity && (() => {
        const idx = node.tx.vin.findIndex((v) => !v.is_coinbase && !graphNodes.has(v.txid));
        return idx >= 0 ? (
          <g className="graph-btn" style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onExpandInput(node.txid, idx); }}>
            <circle cx={node.x - 6} cy={node.y + node.height / 2} r={11} fill={SVG_COLORS.surfaceElevated} stroke={color} strokeWidth={1.5} />
            <Text x={node.x - 6} y={node.y + node.height / 2 + 5} fontSize={16} fontWeight={700} textAnchor="middle" fill={color}>+</Text>
          </g>
        ) : null;
      })()}

      {/* Expand right button (forward) - hidden when all spent outputs are already shown */}
      {!atCapacity && (() => {
        const nonExpandable = new Set<number>();
        for (const [, n] of graphNodes) {
          for (const vin of n.tx.vin) {
            if (vin.txid === node.txid && vin.vout !== undefined) {
              nonExpandable.add(vin.vout);
            }
          }
        }
        for (let i = 0; i < node.tx.vout.length; i++) {
          const out = node.tx.vout[i];
          if (out.scriptpubkey_type === "op_return" || out.value === 0) {
            nonExpandable.add(i);
          }
        }
        const outspends = outspendCache?.get(node.txid);
        if (outspends) {
          for (let i = 0; i < outspends.length; i++) {
            if (!outspends[i].spent) nonExpandable.add(i);
          }
        }
        if (nonExpandable.size >= node.tx.vout.length) return null;
        const idx = node.tx.vout.findIndex((_, i) => !nonExpandable.has(i));
        return idx >= 0 ? (
          <g className="graph-btn" style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onExpandOutput(node.txid, idx); }}>
            <circle cx={node.x + node.width + 6} cy={node.y + node.height / 2} r={11} fill={SVG_COLORS.surfaceElevated} stroke={color} strokeWidth={1.5} />
            <Text x={node.x + node.width + 6} y={node.y + node.height / 2 + 5} fontSize={16} fontWeight={700} textAnchor="middle" fill={color}>+</Text>
          </g>
        ) : null;
      })()}

      {/* Collapse button for non-root nodes */}
      {!node.isRoot && (
        <g className="graph-btn" style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onCollapse(node.txid); }}>
          <circle cx={node.x + node.width - 8} cy={node.y + node.height - 6} r={9} fill={SVG_COLORS.surfaceInset} stroke={SVG_COLORS.muted} strokeWidth={1} />
          <Text x={node.x + node.width - 8} y={node.y + node.height - 2} fontSize={12} fontWeight={700} textAnchor="middle" fill={SVG_COLORS.muted}>x</Text>
        </g>
      )}
    </>
  );
}
