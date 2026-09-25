"use client";

import { Text } from "@visx/text";
import { useTranslation } from "react-i18next";
import { SVG_COLORS } from "../shared/svgConstants";
import { ANNOTATION_COLOR, hexToRgba } from "@/lib/palette";
import type { LayoutNode } from "./types";
import type { EditingLabel } from "./useLabelEditor";
import { SvgCircleButton } from "./SvgCircleButton";

export interface NodeLabelAnnotationProps {
  node: LayoutNode;
  annotateMode?: boolean;
  nodeLabels?: Map<string, string>;
  onSetNodeLabel?: (txid: string, label: string) => void;
  editingLabel: EditingLabel | null;
  editLabelText: string;
  setEditLabelText: (text: string) => void;
  startEditNodeLabel: (txid: string) => void;
  commitLabel: () => void;
}

export function NodeLabelAnnotation({
  node,
  annotateMode,
  nodeLabels,
  onSetNodeLabel,
  editingLabel,
  editLabelText,
  setEditLabelText,
  startEditNodeLabel,
  commitLabel,
}: NodeLabelAnnotationProps) {
  const { t } = useTranslation();
  const label = nodeLabels?.get(node.txid);
  const isEditingThis = editingLabel?.type === "node" && editingLabel.txid === node.txid;
  if (!label && !isEditingThis) return null;

  const labelY = node.y + node.height + 4;

  return (
    <g style={{ pointerEvents: "all", cursor: annotateMode ? "pointer" : "default" }}
      onClick={annotateMode && !isEditingThis ? (e) => { e.stopPropagation(); startEditNodeLabel(node.txid); } : undefined}
    >
      <rect
        x={node.x}
        y={labelY}
        width={node.width}
        height={20}
        rx={4}
        fill={hexToRgba(ANNOTATION_COLOR, 0.12)}
        stroke={ANNOTATION_COLOR}
        strokeWidth={0.5}
        strokeOpacity={0.4}
      />
      {isEditingThis ? (
        <foreignObject x={node.x + 4} y={labelY + 1} width={node.width - 8} height={18}>
          <input
            autoFocus
            type="text"
            value={editLabelText}
            onChange={(e) => setEditLabelText(e.target.value.slice(0, 20))}
            onBlur={commitLabel}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") commitLabel(); }}
            onMouseDown={(e) => e.stopPropagation()}
            placeholder={t("graph.clearToDelete", { defaultValue: "Clear to delete" })}
            style={{
              width: "100%", height: "100%", background: "transparent", color: ANNOTATION_COLOR,
              border: "none", outline: "none", fontSize: "10px", fontFamily: "inherit",
              padding: "0 2px",
            }}
          />
        </foreignObject>
      ) : (
        <Text
          x={node.x + node.width / 2}
          y={labelY + 14}
          fontSize={10}
          fill={ANNOTATION_COLOR}
          textAnchor="middle"
          fontWeight={500}
          style={{ pointerEvents: "none" }}
        >
          {label}
        </Text>
      )}
      {/* Delete button in annotate mode */}
      {annotateMode && !isEditingThis && (
        <SvgCircleButton
          cx={node.x + node.width - 4}
          cy={labelY - 2}
          r={6}
          fill={SVG_COLORS.critical}
          label={t("graph.deleteLabel", { defaultValue: "Delete label" })}
          glyph="x"
          glyphColor="white"
          fontSize={8}
          onActivate={() => onSetNodeLabel?.(node.txid, "")}
        />
      )}
    </g>
  );
}
