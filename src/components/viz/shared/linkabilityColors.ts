/**
 * Shared color utilities for linkability probability visualization.
 * Used by LinkabilityHeatmap, TxFlowDiagram (linkability mode), and GraphExplorer.
 */

/** 8-stop gradient control points: [threshold, [r, g, b]]. */
export const COLOR_STOPS: [number, [number, number, number]][] = [
  [0.00, [17,  24,  39 ]],  // #111827 near-invisible dark
  [0.10, [13,  59,  79 ]],  // #0d3b4f deep teal-navy
  [0.25, [6,   95,  70 ]],  // #065f46 dark emerald
  [0.40, [40,  160, 101]],  // #28a065 green
  [0.55, [181, 146, 21 ]],  // #b59215 dark amber
  [0.70, [217, 119, 6  ]],  // #d97706 amber-orange
  [0.85, [220, 74,  42 ]],  // #dc4a2a red-orange
  [1.00, [239, 68,  68 ]],  // #ef4444 hot red
];

/** Smooth continuous color for probability 0..1 via linear interpolation. */
export function probColor(p: number): string {
  if (p <= 0) return `rgb(${COLOR_STOPS[0][1].join(",")})`;
  if (p >= 1) return `rgb(${COLOR_STOPS[COLOR_STOPS.length - 1][1].join(",")})`;

  for (let s = 1; s < COLOR_STOPS.length; s++) {
    if (p <= COLOR_STOPS[s][0]) {
      const [p0, c0] = COLOR_STOPS[s - 1];
      const [p1, c1] = COLOR_STOPS[s];
      const t = (p - p0) / (p1 - p0);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
      return `rgb(${r},${g},${b})`;
    }
  }
  return `rgb(${COLOR_STOPS[COLOR_STOPS.length - 1][1].join(",")})`;
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

/** Text color class for probability value. */
export function probTextColor(p: number): string {
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
