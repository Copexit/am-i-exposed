"use client";

import { Text } from "@visx/text";

interface SvgCircleButtonProps {
  cx: number;
  cy: number;
  r: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  /** Accessible name (the glyph alone says nothing to a screen reader). */
  label: string;
  glyph: string;
  glyphColor: string;
  fontSize: number;
  onActivate: () => void;
}

/** Round SVG button (graph "+" expand, "x" collapse/delete): clickable and keyboard-activatable. */
export function SvgCircleButton({
  cx, cy, r, fill, stroke, strokeWidth, label, glyph, glyphColor, fontSize, onActivate,
}: SvgCircleButtonProps) {
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      className="graph-btn"
      style={{ cursor: "pointer" }}
      onClick={(e) => { e.stopPropagation(); onActivate(); }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        onActivate();
      }}
    >
      <circle cx={cx} cy={cy} r={r} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      <Text x={cx} y={cy + Math.round(fontSize / 3)} fontSize={fontSize} fontWeight={700} textAnchor="middle" fill={glyphColor} style={{ pointerEvents: "none" }}>
        {glyph}
      </Text>
    </g>
  );
}
