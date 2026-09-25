import type { Grade, Severity } from "@/lib/types";
import { GRADE_HEX } from "@/lib/constants";
import { COLORS, HUES, LIGHT_COLORS } from "@/lib/palette";

interface SurfaceColors {
  readonly background: string;
  readonly foreground: string;
  readonly muted: string;
  readonly cardBg: string;
  readonly cardBorder: string;
  readonly surfaceInset: string;
  readonly surfaceElevated: string;
}

export const DARK_SURFACES: SurfaceColors = {
  background: COLORS.background,
  foreground: COLORS.foreground,
  muted: COLORS.muted,
  cardBg: COLORS.cardBg,
  cardBorder: COLORS.cardBorder,
  surfaceInset: COLORS.surfaceInset,
  surfaceElevated: COLORS.surfaceElevated,
};

const LIGHT_SURFACES: SurfaceColors = LIGHT_COLORS;

/** Returns surface colors matching the current theme. Safe to call at render time. */
export function getSurfaceColors(): SurfaceColors {
  if (typeof document === "undefined") return DARK_SURFACES;
  return document.documentElement.dataset.theme === "light" ? LIGHT_SURFACES : DARK_SURFACES;
}

type SvgColorMap = {
  readonly critical: string;
  readonly high: string;
  readonly medium: string;
  readonly low: string;
  readonly good: string;
  readonly bitcoin: string;
  readonly bitcoinHover: string;
  readonly background: string;
  readonly foreground: string;
  readonly muted: string;
  readonly cardBg: string;
  readonly cardBorder: string;
  readonly surfaceInset: string;
  readonly surfaceElevated: string;
};

const STATIC_COLORS: Record<string, string> = {
  critical: COLORS.severityCritical,
  high: COLORS.severityHigh,
  medium: COLORS.severityMedium,
  low: COLORS.severityLow,
  good: COLORS.severityGood,
  bitcoin: COLORS.bitcoin,
  bitcoinHover: COLORS.bitcoinHover,
};

const SURFACE_KEYS = new Set(Object.keys(DARK_SURFACES));

/**
 * Hex colors for SVG fills/strokes. Surface properties (background, foreground,
 * muted, cardBg, cardBorder, surfaceInset, surfaceElevated) resolve dynamically
 * based on the current theme. Severity and brand colors are static.
 */
export const SVG_COLORS: SvgColorMap = new Proxy(
  { ...STATIC_COLORS, ...DARK_SURFACES } as unknown as SvgColorMap,
  {
    get(target, prop: string) {
      if (SURFACE_KEYS.has(prop)) {
        return getSurfaceColors()[prop as keyof typeof DARK_SURFACES];
      }
      return (target as unknown as Record<string, string>)[prop];
    },
  },
);

/** Map severity to hex color for SVG rendering. */
export const SEVERITY_HEX: Record<Severity, string> = {
  critical: SVG_COLORS.critical,
  high: SVG_COLORS.high,
  medium: SVG_COLORS.medium,
  low: SVG_COLORS.low,
  good: SVG_COLORS.good,
};

/** Grade hex colors for SVG (re-exported from constants for convenience). */
export const GRADE_HEX_SVG: Record<Grade, string> = GRADE_HEX;

/** Grade band thresholds for PrivacyTimeline background. */
export const GRADE_BANDS: { min: number; max: number; grade: Grade; color: string }[] = [
  { min: 90, max: 100, grade: "A+", color: GRADE_HEX["A+"] },
  { min: 75, max: 89, grade: "B", color: GRADE_HEX.B },
  { min: 50, max: 74, grade: "C", color: GRADE_HEX.C },
  { min: 25, max: 49, grade: "D", color: GRADE_HEX.D },
  { min: 0, max: 24, grade: "F", color: GRADE_HEX.F },
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
  inputLight: COLORS.severityLow,
  inputDark: HUES.blue500,
  mixerLight: COLORS.severityGood,
  mixerDark: HUES.emerald600,

  // Warm (exposure)
  outputLight: COLORS.bitcoin,
  outputDark: COLORS.bitcoinHover,
  changeLight: COLORS.severityHigh,
  changeDark: HUES.red600,
  dustLight: COLORS.severityCritical,
  dustDark: HUES.red800,

  // Neutral
  feeLight: HUES.gray500,
  feeDark: HUES.gray600,
  baseLight: HUES.gray400,
  baseDark: HUES.gray500,
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
