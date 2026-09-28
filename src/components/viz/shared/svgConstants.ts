import type { Grade } from "@/lib/types";
import { GRADE_HEX } from "@/lib/constants";
import { COLORS, DARK_PALETTE, LIGHT_PALETTE } from "@/lib/palette";

/** Theme-dependent keys: the neutrals that differ between dark and light. */
const SURFACE_KEY_LIST = ["background", "foreground", "muted", "cardBg", "cardBorder", "surfaceInset", "surfaceElevated"] as const;
type SurfaceKey = (typeof SURFACE_KEY_LIST)[number];
type SurfaceColors = Readonly<Record<SurfaceKey, string>>;

const pick = (p: Readonly<Record<SurfaceKey, string>>): SurfaceColors =>
  Object.fromEntries(SURFACE_KEY_LIST.map((k) => [k, p[k]])) as SurfaceColors;
export const DARK_SURFACES = pick(DARK_PALETTE);
const LIGHT_SURFACES = pick(LIGHT_PALETTE);

const isLight = () => typeof document !== "undefined" && document.documentElement.dataset.theme === "light";

/** Returns surface colors matching the current theme. Safe to call at render time. */
export function getSurfaceColors(): SurfaceColors {
  return isLight() ? LIGHT_SURFACES : DARK_SURFACES;
}

const LIGHT_TEXT: Record<string, string> = {
  [COLORS.bitcoin]: LIGHT_PALETTE.bitcoinText,
  [COLORS.severityCritical]: LIGHT_PALETTE.severityCritical,
  [COLORS.severityHigh]: LIGHT_PALETTE.severityHigh,
  [COLORS.severityMedium]: LIGHT_PALETTE.severityMedium,
  [COLORS.severityLow]: LIGHT_PALETTE.severityLow,
  [COLORS.severityGood]: LIGHT_PALETTE.severityGood,
};

/** Text drawn in a mark color: in light, bright marks swap to their AA text shades. */
export function svgTextColor(color: string): string {
  return isLight() ? (LIGHT_TEXT[color] ?? color) : color;
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
