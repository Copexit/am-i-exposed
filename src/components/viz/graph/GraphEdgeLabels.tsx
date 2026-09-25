"use client";

import { Text } from "@visx/text";
import { SVG_COLORS } from "../shared/svgConstants";
import { ANNOTATION_COLOR, NOTE_BG_COLOR, hexToRgba } from "@/lib/palette";
import type { LayoutEdge } from "./types";
import type { EditingLabel } from "./useLabelEditor";

interface GraphEdgeLabelsProps {
  edges: LayoutEdge[];
  edgeLabels?: Map<string, string>;
  annotateMode?: boolean;
  editingLabel: EditingLabel | null;
  editLabelText: string;
  setEditLabelText: (text: string) => void;
  startEditEdgeLabel: (key: string) => void;
  commitLabel: () => void;
  onSetEdgeLabel?: (key: string, label: string) => void;
}

export function GraphEdgeLabels({
  edges,
  edgeLabels,
  annotateMode,
  editingLabel,
  editLabelText,
  setEditLabelText,
  startEditEdgeLabel,
  commitLabel,
  onSetEdgeLabel,
}: GraphEdgeLabelsProps) {
  return (
    <>
      {edges.map((edge) => {
        const key = `${edge.fromTxid}->${edge.toTxid}`;
        const label = edgeLabels?.get(key);
        const isEditingThis = editingLabel?.type === "edge" && editingLabel.key === key;
        const midX = (edge.x1 + edge.x2) / 2;
        const midY = (edge.y1 + edge.y2) / 2;

        if (annotateMode && !label && !isEditingThis) {
          return (
            <g key={`elbl-${key}`} style={{ cursor: "pointer", pointerEvents: "all" }}
              onClick={(e) => { e.stopPropagation(); startEditEdgeLabel(key); }}
            >
              <circle cx={midX} cy={midY} r={12} fill={hexToRgba(ANNOTATION_COLOR, 0.15)} stroke={ANNOTATION_COLOR} strokeWidth={1} strokeDasharray="3 2" />
              <Text x={midX} y={midY + 4} fontSize={12} fontWeight={700} textAnchor="middle" fill={ANNOTATION_COLOR} fillOpacity={0.6}>+</Text>
            </g>
          );
        }

        if (!label && !isEditingThis) return null;

        return (
          <g key={`elbl-${key}`} style={{ pointerEvents: "all", cursor: annotateMode ? "pointer" : "default" }}
            onClick={annotateMode ? (e) => { e.stopPropagation(); startEditEdgeLabel(key); } : undefined}
          >
            <rect x={midX - 55} y={midY - 11} width={110} height={22} rx={4}
              fill={hexToRgba(NOTE_BG_COLOR, 0.9)} stroke={ANNOTATION_COLOR} strokeWidth={0.5} strokeOpacity={0.4}
            />
            {isEditingThis ? (
              <foreignObject x={midX - 50} y={midY - 9} width={100} height={18}>
                <input autoFocus type="text" value={editLabelText}
                  onChange={(e) => setEditLabelText(e.target.value.slice(0, 20))}
                  onBlur={commitLabel}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") commitLabel(); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  placeholder="Clear to delete"
                  style={{ width: "100%", height: "100%", background: "transparent", color: ANNOTATION_COLOR, border: "none", outline: "none", fontSize: "10px", fontFamily: "inherit", textAlign: "center", padding: "0" }}
                />
              </foreignObject>
            ) : (
              <Text x={midX} y={midY + 4} fontSize={10} fill={ANNOTATION_COLOR} textAnchor="middle" fontWeight={500} style={{ pointerEvents: "none" }}>{label}</Text>
            )}
            {/* Delete button in annotate mode */}
            {annotateMode && !isEditingThis && (
              <g style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onSetEdgeLabel?.(key, ""); }}>
                <circle cx={midX + 50} cy={midY - 6} r={6} fill={SVG_COLORS.critical} />
                <Text x={midX + 50} y={midY - 3} fontSize={8} fontWeight={700} textAnchor="middle" fill="white" style={{ pointerEvents: "none" }}>x</Text>
              </g>
            )}
          </g>
        );
      })}
    </>
  );
}
