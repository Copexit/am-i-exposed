import type { Grade, Severity } from "@/lib/types";

/** Hex colors matching CSS custom properties for use in SVG fills/strokes. */
export const SVG_COLORS = {
  // Severity levels
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#3b82f6",
  good: "#28d065",

  // Brand
  bitcoin: "#f7931a",
  bitcoinHover: "#e8850f",

  // Surfaces
  background: "#0c0c0e",
  foreground: "#f0f0f2",
  muted: "#c8c8d0",
  cardBg: "#1c1c20",
  cardBorder: "#444450",
  surfaceInset: "#151518",
  surfaceElevated: "#222228",
} as const;

/** Map severity to hex color for SVG rendering. */
export const SEVERITY_HEX: Record<Severity, string> = {
  critical: SVG_COLORS.critical,
  high: SVG_COLORS.high,
  medium: SVG_COLORS.medium,
  low: SVG_COLORS.low,
  good: SVG_COLORS.good,
};

/** Grade hex colors for SVG (mirrors GRADE_HEX from constants). */
export const GRADE_HEX_SVG: Record<Grade, string> = {
  "A+": "#28d065",
  B: "#3b82f6",
  C: "#eab308",
  D: "#f97316",
  F: "#ef4444",
};

/** Grade band thresholds for PrivacyTimeline background. */
export const GRADE_BANDS: { min: number; max: number; grade: Grade; color: string }[] = [
  { min: 90, max: 100, grade: "A+", color: "#28d065" },
  { min: 75, max: 89, grade: "B", color: "#3b82f6" },
  { min: 50, max: 74, grade: "C", color: "#eab308" },
  { min: 25, max: 49, grade: "D", color: "#f97316" },
  { min: 0, max: 24, grade: "F", color: "#ef4444" },
];

/** Default motion animation config. */
export const ANIMATION_DEFAULTS = {
  stagger: 0.05,
  duration: 0.4,
  spring: { type: "spring" as const, stiffness: 200, damping: 25 },
};

/** Gradient color palette for semantic meaning in charts. */
export const GRADIENT_COLORS = {
  // Cool (privacy-positive)
  inputLight: "#60a5fa",
  inputDark: "#3b82f6",
  mixerLight: "#28d065",
  mixerDark: "#059669",

  // Warm (exposure)
  outputLight: "#f7931a",
  outputDark: "#e8850f",
  changeLight: "#f97316",
  changeDark: "#dc2626",
  dustLight: "#ef4444",
  dustDark: "#991b1b",

  // Neutral
  feeLight: "#6b7280",
  feeDark: "#4b5563",
  baseLight: "#9ca3af",
  baseDark: "#6b7280",
} as const;

/** Lookup from waterfall bar type to gradient ID. */
export const WATERFALL_GRADIENT_IDS: Record<string, string> = {
  base: "grad-wf-base",
  positive: "grad-wf-positive",
  critical: "grad-wf-critical",
  high: "grad-wf-high",
  medium: "grad-wf-medium",
  low: "grad-wf-low",
  good: "grad-wf-good",
} as const;

/** Dust threshold in satoshis - matches dust-output.ts heuristic. */
export const DUST_THRESHOLD = 1000;
