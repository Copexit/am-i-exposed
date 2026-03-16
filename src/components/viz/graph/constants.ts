import { SVG_COLORS } from "../shared/svgConstants";
import type { EntityCategory } from "@/lib/analysis/entities";

// ─── Node dimensions ────────────────────────────────────────────
export const NODE_W = 180;
export const NODE_H = 56;
export const COL_GAP = 100;
export const ROW_GAP = 24;
export const MARGIN = { top: 50, right: 40, bottom: 20, left: 40 };

/** Horizontal/vertical scroll margin (px) before auto-scrolling to focused node. */
export const SCROLL_MARGIN_X = 100;
export const SCROLL_MARGIN_Y = 50;

// ─── Zoom limits ────────────────────────────────────────────────
export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 3;

// ─── Minimap ────────────────────────────────────────────────────
export const MINIMAP_W = 160;
export const MINIMAP_H = 100;

// ─── Entity category colors ────────────────────────────────────
/** Category-specific colors for entity nodes. */
export const ENTITY_CATEGORY_COLORS: Record<EntityCategory | "unknown", string> = {
  exchange: "#06b6d4",   // teal (distinct from standard-tx blue and root-tx orange)
  darknet: SVG_COLORS.critical,
  scam: SVG_COLORS.critical,
  mixer: SVG_COLORS.good,
  gambling: SVG_COLORS.medium,
  mining: "#9ca3af",     // gray
  payment: "#a78bfa",    // purple
  p2p: "#e879f9",       // fuchsia (distinct from P2SH orange)
  unknown: "#9ca3af",   // gray (neutral, like mining)
};

// ─── Expanded node dimensions ───────────────────────────────────
export const EXPANDED_NODE_W = 300;
export const PORT_H = 26;
export const PORT_GAP = 2;
export const EXPANDED_HEADER_H = 40;
export const EXPANDED_PAD_V = 8;
/** Max ports per side before overflow. */
export const MAX_VISIBLE_PORTS = 20;
/** Width of each port column (input or output). */
export const PORT_COL_W = 135;
/** Width of the center info area in expanded node. */
export const CENTER_COL_W = EXPANDED_NODE_W - PORT_COL_W * 2;

// ─── Heat map ───────────────────────────────────────────────────
/** Heat map score thresholds and corresponding colors. */
export const HEAT_TIERS: readonly { min: number; color: string }[] = [
  { min: 90, color: SVG_COLORS.good },
  { min: 75, color: "#60a5fa" },   // blue-400
  { min: 50, color: SVG_COLORS.medium },
  { min: 25, color: SVG_COLORS.high },
];
export const HEAT_FLOOR_COLOR = SVG_COLORS.critical;
