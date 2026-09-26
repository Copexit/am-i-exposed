import type { Grade, Severity } from "@/lib/types";
import { GRADE_HEX } from "@/lib/constants";
import { COLORS, HUES, LIGHT_COLORS, V2_DARK_PALETTE, V2_LIGHT_PALETTE } from "@/lib/palette";

type SurfaceKey = keyof typeof LIGHT_COLORS;
type SurfaceColors = Readonly<Record<SurfaceKey, string>>;

/** Theme-dependent keys: the ones the light theme overrides. */
const SURFACE_KEY_LIST = Object.keys(LIGHT_COLORS) as SurfaceKey[];

export const DARK_SURFACES: SurfaceColors = Object.fromEntries(
  SURFACE_KEY_LIST.map((k) => [k, COLORS[k]]),
) as SurfaceColors;

const pick = (p: Readonly<Record<SurfaceKey, string>>): SurfaceColors =>
  Object.fromEntries(SURFACE_KEY_LIST.map((k) => [k, p[k]])) as SurfaceColors;
const V2_DARK_SURFACES = pick(V2_DARK_PALETTE);
const V2_LIGHT_SURFACES = pick(V2_LIGHT_PALETTE);

/** Returns surface colors matching the current theme (and UI, v2 or classic). Safe to call at render time. */
export function getSurfaceColors(): SurfaceColors {
  if (typeof document === "undefined") return DARK_SURFACES;
  const { theme, ui } = document.documentElement.dataset;
  if (ui === "v2") return theme === "light" ? V2_LIGHT_SURFACES : V2_DARK_SURFACES;
  return theme === "light" ? LIGHT_COLORS : DARK_SURFACES;
}

const V2_LIGHT_TEXT: Record<string, string> = {
  [COLORS.bitcoin]: V2_LIGHT_PALETTE.bitcoinText,
  [COLORS.severityCritical]: V2_LIGHT_PALETTE.severityCritical,
  [COLORS.severityHigh]: V2_LIGHT_PALETTE.severityHigh,
  [COLORS.severityMedium]: V2_LIGHT_PALETTE.severityMedium,
  [COLORS.severityLow]: V2_LIGHT_PALETTE.severityLow,
  [COLORS.severityGood]: V2_LIGHT_PALETTE.severityGood,
};

/** Text drawn in a mark color: in v2 light, bright marks swap to their AA text shades. */
export function svgTextColor(color: string): string {
  if (typeof document === "undefined") return color;
  const { theme, ui } = document.documentElement.dataset;
  return ui === "v2" && theme === "light" ? (V2_LIGHT_TEXT[color] ?? color) : color;
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

const SURFACE_KEYS = new Set<string>(SURFACE_KEY_LIST);

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
        return getSurfaceColors()[prop as SurfaceKey];
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
