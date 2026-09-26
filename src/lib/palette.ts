/**
 * Single source of truth for color values needed in JS (SVG fills, canvas,
 * inline styles). className code should use the Tailwind semantic classes
 * generated from globals.css instead (text-severity-high, bg-surface-inset).
 *
 * COLORS and LIGHT_COLORS mirror the hex custom properties declared in
 * src/app/globals.css (`:root` and `html[data-theme="light"]`), keyed by the
 * camelCased property name. palette.test.ts parses the CSS and fails on drift.
 */

/** Dark theme tokens (`:root` in globals.css). */
export const COLORS = {
  background: "#0c0c0e",
  foreground: "#f0f0f2",
  muted: "#d4d4dc",
  cardBg: "#1c1c20",
  cardBorder: "#444450",
  surfaceInset: "#151518",
  surfaceElevated: "#222228",
  bitcoin: "#f7931a",
  bitcoinHover: "#e8850f",
  violet: "#8b5cf6",
  success: "#28d065",
  warning: "#eab308",
  danger: "#ef4444",
  info: "#60a5fa",
  severityCritical: "#ef4444",
  severityHigh: "#f97316",
  severityMedium: "#eab308",
  severityLow: "#60a5fa",
  severityGood: "#28d065",
} as const;

/** Light theme overrides (`html[data-theme="light"]` in globals.css). */
export const LIGHT_COLORS = {
  background: "#f8fafc",
  foreground: "#0f172a",
  muted: "#475569",
  cardBg: "#ffffff",
  cardBorder: "#cbd5e1",
  surfaceInset: "#f1f5f9",
  surfaceElevated: "#ffffff",
} as const;

/** v2 UI overrides (`[data-ui="v2"]` in globals.css); other tokens as COLORS. */
export const V2_COLORS = {
  background: "#0b0b0d",
  foreground: "#f2f2f4",
  muted: "#a6a6b0",
  faint: "#70707b",
  surface1: "#111114",
  surface2: "#17171b",
  cardBg: "#17171b",
  surfaceInset: "#111114",
  surfaceElevated: "#1d1d22",
  bitcoinText: "#f7931a",
} as const;

/** v2 light overrides (`html[data-theme="light"] [data-ui="v2"]`), applied over V2_COLORS. */
export const V2_LIGHT_COLORS = {
  background: "#fafaf9",
  foreground: "#131316",
  muted: "#55555f",
  faint: "#8a8a94",
  surface1: "#f4f4f2",
  surface2: "#ffffff",
  cardBg: "#ffffff",
  cardBorder: "#e2e2de",
  surfaceInset: "#f4f4f2",
  surfaceElevated: "#ffffff",
  bitcoinText: "#b45309",
  success: "#15803d",
  warning: "#a16207",
  danger: "#dc2626",
  info: "#2563eb",
  severityCritical: "#dc2626",
  severityHigh: "#c2410c",
  severityMedium: "#a16207",
  severityLow: "#2563eb",
  severityGood: "#15803d",
} as const;

type V2Palette = Readonly<Record<keyof typeof COLORS | keyof typeof V2_LIGHT_COLORS, string>>;

/** Full resolved v2 palettes for JS-drawn surfaces (canvas, SVG, inline styles). */
export const V2_DARK_PALETTE: V2Palette = { ...COLORS, ...V2_COLORS };
export const V2_LIGHT_PALETTE: V2Palette = { ...COLORS, ...V2_COLORS, ...V2_LIGHT_COLORS };

/**
 * Fixed chart hues (Tailwind default-scale values plus the brand green), used
 * by SVG gradients and graph encodings. Independent of the semantic tokens, so
 * a severity palette change never recolors a data encoding.
 */
export const HUES = {
  brandGreen: "#28d065",
  red300: "#fca5a5",
  red400: "#f87171",
  red600: "#dc2626",
  red800: "#991b1b",
  orange400: "#fb923c",
  orange500: "#f97316",
  orange600: "#ea580c",
  amber300: "#fcd34d",
  amber400: "#fbbf24",
  amber500: "#f59e0b",
  amber600: "#d97706",
  yellow400: "#facc15",
  yellow600: "#ca8a04",
  green400: "#4ade80",
  green600: "#16a34a",
  emerald400: "#34d399",
  emerald600: "#059669",
  emerald800: "#065f46",
  cyan500: "#06b6d4",
  blue300: "#93c5fd",
  blue400: "#60a5fa",
  blue500: "#3b82f6",
  blue600: "#2563eb",
  violet400: "#a78bfa",
  violet500: "#8b5cf6",
  fuchsia400: "#e879f9",
  fuchsia600: "#c026d3",
  pink500: "#ec4899",
  slate300: "#cbd5e1",
  gray400: "#9ca3af",
  gray500: "#6b7280",
  gray600: "#4b5563",
  gray900: "#111827",
  stone500: "#78716c",
  neutral200: "#e5e5e5",
} as const;

/** Graph annotation accent (labels, shapes, selection). */
export const ANNOTATION_COLOR = HUES.amber500;

/** Edge/legend color for outputs the user marked as change. */
export const CHANGE_MARKED_COLOR = HUES.amber600;

/**
 * Neutral tones for rasterized images (share card canvas, OG image), which
 * cannot read CSS custom properties.
 */
export const IMAGE_TONES = {
  dimText: "#787880",
  faintText: "#505058",
  footerText: "#4a4a52",
  track: "#1a1a1e",
  gridLine: "rgba(255, 255, 255, 0.03)",
  divider: "rgba(255, 255, 255, 0.06)",
} as const;

/** Parse "#rrggbb" into an [r, g, b] tuple. */
export function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Convert "#rrggbb" to an rgba() string with the given opacity. */
export function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
