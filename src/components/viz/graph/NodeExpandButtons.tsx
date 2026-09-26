"use client";

import { useTranslation } from "react-i18next";
import { SVG_COLORS } from "../shared/svgConstants";
import type { LayoutNode, GraphNode } from "./types";
import type { MempoolOutspend } from "@/lib/api/types";
import { isOpReturnOutput } from "@/lib/analysis/heuristics/tx-utils";
import { SvgCircleButton } from "./SvgCircleButton";

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
  const { t } = useTranslation();
  const expandProps = { r: 11, fill: SVG_COLORS.surfaceElevated, stroke: color, strokeWidth: 1.5, glyph: "+", glyphColor: color, fontSize: 16 };
  return (
    <>
      {/* Expand left button (backward) */}
      {!atCapacity && (() => {
        const idx = node.tx.vin.findIndex((v) => !v.is_coinbase && !graphNodes.has(v.txid));
        return idx >= 0 ? (
          <SvgCircleButton
            {...expandProps}
            cx={node.x - 6}
            cy={node.y + node.height / 2}
            label={t("graph.expandInputs", { defaultValue: "Expand inputs" })}
            onActivate={() => onExpandInput(node.txid, idx)}
          />
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
        for (const [i, out] of node.tx.vout.entries()) {
          if (isOpReturnOutput(out) || out.value === 0) {
            nonExpandable.add(i);
          }
        }
        const outspends = outspendCache?.get(node.txid);
        if (outspends) {
          for (const [i, os] of outspends.entries()) {
            if (!os.spent) nonExpandable.add(i);
          }
        }
        if (nonExpandable.size >= node.tx.vout.length) return null;
        const idx = node.tx.vout.findIndex((_, i) => !nonExpandable.has(i));
        return idx >= 0 ? (
          <SvgCircleButton
            {...expandProps}
            cx={node.x + node.width + 6}
            cy={node.y + node.height / 2}
            label={t("graph.expandOutputs", { defaultValue: "Expand outputs" })}
            onActivate={() => onExpandOutput(node.txid, idx)}
          />
        ) : null;
      })()}

      {/* Collapse button for non-root nodes */}
      {!node.isRoot && (
        <SvgCircleButton
          cx={node.x + node.width - 8}
          cy={node.y + node.height - 6}
          r={9}
          fill={SVG_COLORS.surfaceInset}
          stroke={SVG_COLORS.muted}
          strokeWidth={1}
          label={t("graph.collapseNode", { defaultValue: "Collapse node" })}
          glyph="x"
          glyphColor={SVG_COLORS.muted}
          fontSize={12}
          onActivate={() => onCollapse(node.txid)}
        />
      )}
    </>
  );
}
