/**
 * Shared color utilities for linkability probability visualization.
 * Used by LinkabilityHeatmap, TxFlowDiagram (linkability mode), and GraphExplorer.
 */

import { COLORS, HUES, hexToRgb } from "@/lib/palette";

type ColorStop = [number, [number, number, number]];
type ColorRamp = [ColorStop, ...ColorStop[]];

const stop = (p: number, hex: string): ColorStop => [p, hexToRgb(hex)];

/** Mid-ramp dark-mode stops without a palette entry. */
const RAMP_TEAL = "#0d3b4f";
const RAMP_GREEN = "#28a065";
const RAMP_AMBER = "#b59215";
const RAMP_RED = "#dc4a2a";

/** Dark-mode gradient: dark navy to hot red. */
const COLOR_STOPS: ColorRamp = [
  stop(0.00, HUES.gray900),           // dark navy
  stop(0.10, RAMP_TEAL),              // deep teal
  stop(0.25, HUES.emerald800),        // dark emerald
  stop(0.40, RAMP_GREEN),             // green
  stop(0.55, RAMP_AMBER),             // dark amber
  stop(0.70, HUES.amber600),          // amber-orange
  stop(0.85, RAMP_RED),               // red-orange
  stop(1.00, COLORS.severityCritical), // hot red
];

/** Light-mode gradient: cool slate to hot red (pastel-to-vivid for light backgrounds). */
const COLOR_STOPS_LIGHT: ColorRamp = [
  stop(0.00, HUES.slate300),
  stop(0.10, HUES.blue300),
  stop(0.25, HUES.green400),
  stop(0.40, HUES.emerald400),
  stop(0.55, HUES.yellow400),
  stop(0.70, HUES.orange400),
  stop(0.85, HUES.red400),
  stop(1.00, COLORS.severityCritical),
];

/** Efficiency bar colors (high / mid / low), sampled from the dark ramp. */
export const EFFICIENCY_COLORS = {
  high: RAMP_GREEN,
  mid: RAMP_AMBER,
  low: HUES.amber600,
} as const;

function isLightTheme(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "light";
}

/** Returns the active color stops for the current theme. */
export function getColorStops(): ColorRamp {
  return isLightTheme() ? COLOR_STOPS_LIGHT : COLOR_STOPS;
}

/** Smooth continuous color for probability 0..1 via linear interpolation. */
export function probColor(p: number): string {
  const stops = getColorStops();
  let prev = stops[0];
  if (p <= 0) return `rgb(${prev[1].join(",")})`;

  // The first stop sits at 0, so it never matches here and prev is always the stop below.
  for (const cur of stops) {
    if (p <= cur[0]) {
      const [p0, c0] = prev;
      const [p1, c1] = cur;
      const t = (p - p0) / (p1 - p0);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
      return `rgb(${r},${g},${b})`;
    }
    prev = cur;
  }
  // p >= 1 (or NaN): clamp to the last stop.
  return `rgb(${prev[1].join(",")})`;
}

/** Inner (+ optional outer) glow for heat map cells. */
export function cellGlow(p: number): string {
  if (p <= 0) return "none";
  const c = probColor(p);
  const toRgba = (opacity: number) =>
    c.replace("rgb(", "rgba(").replace(")", `,${opacity})`);
  const inner = `inset 0 0 10px ${toRgba(0.25)}`;
  if (p >= 0.75) return `${inner}, 0 0 8px ${toRgba(0.2)}`;
  return inner;
}

/** Text color class for probability value. Theme-aware for cell readability. */
export function probTextColor(p: number): string {
  if (isLightTheme()) {
    // Light theme: brighter cells need dark text until orange/red range
    if (p >= 0.7) return "text-white font-semibold";
    if (p >= 0.55) return "text-white/90";
    if (p > 0) return "text-foreground/80";
    return "text-foreground/40";
  }
  // Dark theme: all cells have dark backgrounds, white text works
  if (p >= 0.75) return "text-white font-semibold";
  if (p >= 0.5) return "text-white/90";
  if (p > 0) return "text-white/70";
  return "text-white/30";
}

/** Qualitative label for probability. */
export function probLabel(p: number): string {
  if (p >= 1.0) return "Deterministic";
  if (p >= 0.75) return "Likely";
  if (p >= 0.50) return "Probable";
  if (p >= 0.25) return "Ambiguous";
  if (p > 0) return "Unlikely";
  return "No link";
}
