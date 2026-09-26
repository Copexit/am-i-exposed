"use client";

import { useTranslation } from "react-i18next";
import { Text } from "@visx/text";
import type { GraphAnnotation } from "@/lib/graph/saved-graph-types";
import type { ViewTransform } from "./types";
import { SVG_COLORS } from "../shared/svgConstants";
import { ANNOTATION_COLOR, hexToRgba } from "@/lib/palette";
import { useTheme } from "@/hooks/useTheme";
import { useAnnotationInteraction } from "./useAnnotationInteraction";

// ─── Annotation colors ──────────────────────────────────────────
const ANNOTATION_ACCENT = ANNOTATION_COLOR; // amber (selection, shapes, labels)
const ANNOTATION_ACCENT_FILL = hexToRgba(ANNOTATION_COLOR, 0.06);
const ANNOTATION_ACCENT_PREVIEW = hexToRgba(ANNOTATION_COLOR, 0.08);
const DELETE_COLOR = SVG_COLORS.critical;   // red

interface GraphAnnotationsProps {
  annotations: GraphAnnotation[];
  annotateMode: boolean;
  viewTransform?: ViewTransform;
  onAdd: (annotation: GraphAnnotation) => void;
  onUpdate: (id: string, patch: Partial<GraphAnnotation>) => void;
  onDelete: (id: string) => void;
}

const DEFAULT_NOTE_W = 180;
const DEFAULT_NOTE_H = 100;
const NOTE_PAD = 8;
const RESIZE_HANDLE = 10;

export function GraphAnnotations({
  annotations,
  annotateMode,
  viewTransform,
  onAdd,
  onUpdate,
  onDelete,
}: GraphAnnotationsProps) {
  const { t } = useTranslation();
  useTheme(); // re-render on theme change: note colors follow the surfaces
  const NOTE_BG = hexToRgba(SVG_COLORS.surfaceElevated, 0.9);
  const NOTE_TEXT = SVG_COLORS.foreground;
  const DEFAULT_BORDER = hexToRgba(SVG_COLORS.foreground, 0.2);
  const interaction = useAnnotationInteraction(annotateMode, viewTransform, onAdd, onUpdate);
  const {
    selectedId, setSelectedId, editingId, editTitle, editBody,
    setEditTitle, setEditBody, drawState, flushEdit,
    handleCanvasMouseDown, handleCanvasMouseMove, handleCanvasMouseUp,
    handleAnnotationMouseDown, handleResizeMouseDown, handleAnnotationDoubleClick,
  } = interaction;

  // ---- Render helpers ----

  const renderDeleteBtn = (cx: number, cy: number, id: string) => (
    <g style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onDelete(id); setSelectedId(null); }}>
      <circle cx={cx} cy={cy} r={8} fill={DELETE_COLOR} />
      <Text x={cx} y={cy + 4} fontSize={10} fontWeight={700} textAnchor="middle" fill="white">x</Text>
    </g>
  );

  const renderResizeHandle = (x: number, y: number, a: GraphAnnotation) => (
    <rect
      x={x - RESIZE_HANDLE / 2}
      y={y - RESIZE_HANDLE / 2}
      width={RESIZE_HANDLE}
      height={RESIZE_HANDLE}
      rx={2}
      fill={ANNOTATION_ACCENT}
      fillOpacity={0.6}
      style={{ cursor: "nwse-resize" }}
      onMouseDown={(e) => handleResizeMouseDown(e, a)}
    />
  );

  const renderNoteEditor = (x: number, y: number, w: number, h: number, color: string) => (
    <foreignObject x={x} y={y} width={w} height={h}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", gap: "3px" }}>
        <input
          autoFocus
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value.slice(0, 20))}
          onKeyDown={(e) => { if (e.key === "Escape") flushEdit(); }}
          placeholder={t("graph.annotation.titlePlaceholder", { defaultValue: "Title (max 20)" })}
          style={{
            width: "100%", background: "transparent", color,
            border: "none", borderBottom: `1px solid ${color}33`, outline: "none",
            fontSize: "11px", fontWeight: 600, fontFamily: "inherit", padding: "1px 0",
          }}
        />
        <textarea
          value={editBody}
          onChange={(e) => setEditBody(e.target.value.slice(0, 5000))}
          onBlur={flushEdit}
          onKeyDown={(e) => { if (e.key === "Escape") flushEdit(); }}
          placeholder={t("graph.annotation.bodyPlaceholder", { defaultValue: "Notes (saved to workspace)..." })}
          style={{
            flex: 1, width: "100%", background: "transparent", color,
            border: "none", outline: "none", resize: "none",
            fontSize: "10px", fontFamily: "inherit", lineHeight: "1.4",
            padding: "2px 0", opacity: 0.8,
          }}
        />
      </div>
    </foreignObject>
  );

  const renderShapeEditor = (x: number, y: number, w: number, color: string) => (
    <foreignObject x={x} y={y} width={w} height={20}>
      <input
        autoFocus
        type="text"
        value={editTitle}
        onChange={(e) => setEditTitle(e.target.value.slice(0, 20))}
        onBlur={flushEdit}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") flushEdit(); }}
        placeholder={t("graph.annotation.labelPlaceholder", { defaultValue: "Label (max 20)" })}
        style={{
          width: "100%", height: "18px", background: "transparent", color,
          border: "none", outline: "none",
          fontSize: "11px", fontWeight: 600, fontFamily: "inherit", padding: "0 2px",
        }}
      />
    </foreignObject>
  );

  // ---- Annotation rendering per type ----

  const renderAnnotation = (a: GraphAnnotation) => {
    const isSelected = selectedId === a.id && annotateMode;
    const isEditing = editingId === a.id;
    const borderColor = isSelected ? ANNOTATION_ACCENT : (a.color || DEFAULT_BORDER);
    const interactionStyle: React.CSSProperties = { pointerEvents: annotateMode ? "all" : "none", cursor: annotateMode ? "move" : "default" };

    // Shape body plus where the selection chrome (delete button, resize handle) sits
    let shape: React.ReactNode;
    let deleteAt: [number, number];
    let resizeAt: [number, number] | null = null;

    if (a.type === "note") {
      const w = a.width ?? DEFAULT_NOTE_W;
      const h = a.height ?? DEFAULT_NOTE_H;
      shape = (
        <>
          <rect x={a.x} y={a.y} width={w} height={h} rx={6}
            fill={NOTE_BG} stroke={borderColor} strokeWidth={isSelected ? 1.5 : 1} />
          {isEditing ? (
            renderNoteEditor(a.x + NOTE_PAD, a.y + NOTE_PAD, w - NOTE_PAD * 2, h - NOTE_PAD * 2, NOTE_TEXT)
          ) : (
            <>
              <Text x={a.x + NOTE_PAD} y={a.y + NOTE_PAD + 13} fontSize={11} fontWeight={600} fill={NOTE_TEXT} width={w - NOTE_PAD * 2}>
                {a.title || (annotateMode ? t("graph.annotation.doubleClickToEdit", { defaultValue: "Double-click to edit" }) : "")}
              </Text>
              {a.body && (
                <Text x={a.x + NOTE_PAD} y={a.y + NOTE_PAD + 28} fontSize={10} fill={NOTE_TEXT} fillOpacity={0.6} width={w - NOTE_PAD * 2}>
                  {a.body.length > 80 ? a.body.slice(0, 80) + "..." : a.body}
                </Text>
              )}
            </>
          )}
        </>
      );
      deleteAt = [a.x + w - 4, a.y - 4];
      resizeAt = [a.x + w, a.y + h];
    } else if (a.type === "rect") {
      const w = a.width ?? 120;
      const h = a.height ?? 80;
      shape = (
        <>
          <rect x={a.x} y={a.y} width={w} height={h} rx={4}
            fill={ANNOTATION_ACCENT_FILL} stroke={borderColor} strokeWidth={isSelected ? 1.5 : 1} strokeDasharray="6 4" />
          {isEditing ? (
            renderShapeEditor(a.x + NOTE_PAD, a.y + h / 2 - 10, w - NOTE_PAD * 2, ANNOTATION_ACCENT)
          ) : a.title ? (
            <Text x={a.x + w / 2} y={a.y + h / 2 + 4} fontSize={11} fontWeight={600} fill={ANNOTATION_ACCENT} textAnchor="middle" width={w - NOTE_PAD * 2}>{a.title}</Text>
          ) : null}
        </>
      );
      deleteAt = [a.x + w - 4, a.y - 4];
      resizeAt = [a.x + w, a.y + h];
    } else if (a.type === "circle") {
      const r = a.radius ?? 50;
      shape = (
        <>
          <circle cx={a.x} cy={a.y} r={r}
            fill={ANNOTATION_ACCENT_FILL} stroke={borderColor} strokeWidth={isSelected ? 1.5 : 1} strokeDasharray="6 4" />
          {isEditing ? (
            renderShapeEditor(a.x - r * 0.6, a.y - 10, r * 1.2, ANNOTATION_ACCENT)
          ) : a.title ? (
            <Text x={a.x} y={a.y + 4} fontSize={11} fontWeight={600} fill={ANNOTATION_ACCENT} textAnchor="middle" width={r * 1.4}>{a.title}</Text>
          ) : null}
        </>
      );
      deleteAt = [a.x + r * 0.7, a.y - r * 0.7];
    } else {
      return null;
    }

    return (
      <g key={a.id} data-annotation={a.id}
        onMouseDown={(e) => handleAnnotationMouseDown(e, a)}
        onDoubleClick={(e) => handleAnnotationDoubleClick(e, a)}
        style={interactionStyle}
      >
        {shape}
        {isSelected && renderDeleteBtn(deleteAt[0], deleteAt[1], a.id)}
        {isSelected && resizeAt && renderResizeHandle(resizeAt[0], resizeAt[1], a)}
      </g>
    );
  };

  return (
    <g
      onMouseDown={handleCanvasMouseDown}
      onMouseMove={handleCanvasMouseMove}
      onMouseUp={handleCanvasMouseUp}
      style={{ pointerEvents: annotateMode ? "all" : "none", cursor: annotateMode ? "crosshair" : "default" }}
    >
      {/* Hit area for canvas clicks in annotate mode */}
      {annotateMode && (
        <rect x={-10000} y={-10000} width={30000} height={30000} fill="transparent" pointerEvents="all" style={{ cursor: "crosshair" }} />
      )}

      {/* Drawing preview */}
      {drawState && (() => {
        const dx = drawState.currentX - drawState.startX;
        const dy = drawState.currentY - drawState.startY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 10) return null;
        if (drawState.isCircle) {
          const cx = (drawState.startX + drawState.currentX) / 2;
          const cy = (drawState.startY + drawState.currentY) / 2;
          return (
            <circle cx={cx} cy={cy} r={dist / 2}
              fill={ANNOTATION_ACCENT_PREVIEW} stroke={ANNOTATION_ACCENT} strokeWidth={1.5} strokeDasharray="6 4" />
          );
        }
        const x = Math.min(drawState.startX, drawState.currentX);
        const y = Math.min(drawState.startY, drawState.currentY);
        return (
          <rect x={x} y={y} width={Math.abs(dx)} height={Math.abs(dy)} rx={4}
            fill={ANNOTATION_ACCENT_PREVIEW} stroke={ANNOTATION_ACCENT} strokeWidth={1.5} strokeDasharray="6 4" />
        );
      })()}

      {/* Rendered annotations */}
      {annotations.map(renderAnnotation)}
    </g>
  );
}
