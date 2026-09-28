/**
 * Pure helper functions for the LinkabilityHeatmap component.
 * Extracted to reduce component file size and improve testability.
 */

import { probColor, cellGlow, probTextColor } from "./linkabilityColors";

/** Resolved visual state for a single heatmap cell. */
export interface CellVisuals {
  /** Display probability (0 if unreliable). */
  displayProb: number;
  /** Whether this is a 100% deterministic link (never when timed out). */
  isDeterministic: boolean;
  /** Whether this cell is unreliable (timed out, partial result). */
  isUnreliable: boolean;
  /** Background color for the cell. */
  backgroundColor: string;
  /** Box-shadow glow effect. */
  boxShadow: string;
  /** CSS class for the probability text. */
  textClass: string;
  /** Display text inside the cell. */
  label: string;
}

/**
 * Compute the visual state for a single heatmap cell.
 * This is a pure function - no side effects, no DOM access.
 */
export function computeCellVisuals(
  prob: number,
  timedOut: boolean,
): CellVisuals {
  // A timed-out enumeration proves nothing: 0 may be not-yet-found, 1 an artifact
  const isUnreliable = timedOut;
  const isDeterministic = prob >= 1.0 && !isUnreliable;
  const displayProb = isUnreliable ? 0 : prob;
  const backgroundColor = isUnreliable ? "var(--surface-inset)" : probColor(displayProb);
  const boxShadow = isUnreliable ? "none" : cellGlow(displayProb);
  const textClass = isUnreliable ? "text-muted/30 italic" : probTextColor(displayProb);
  const label = isUnreliable ? "N/A" : prob === 0 ? "-" : `${(prob * 100).toFixed(0)}%`;

  return {
    displayProb,
    isDeterministic,
    isUnreliable,
    backgroundColor,
    boxShadow,
    textClass,
    label,
  };
}

/** Tooltip data shape for the LinkabilityHeatmap. */
export interface HeatmapTooltipData {
  outAddr: string | undefined;
  inAddr: string | undefined;
  prob: number;
  count: number;
  total: number;
}

/**
 * Build tooltip data for a heatmap cell.
 */
export function buildHeatmapTooltipData(
  inAddr: string | undefined,
  outAddr: string | undefined,
  prob: number,
  count: number,
  total: number,
  isUnreliable: boolean,
): HeatmapTooltipData {
  return {
    inAddr,
    outAddr,
    prob: isUnreliable ? -1 : prob,
    count,
    total,
  };
}

/**
 * Format elapsed time for the stats pill.
 */
export function formatElapsed(ms: number): string {
  return ms >= 1000
    ? `${(ms / 1000).toFixed(1)}s`
    : `${ms}ms`;
}

/**
 * Format estimated remaining time for the progress display.
 */
export function formatRemainingTime(estimatedMs: number): string | null {
  if (estimatedMs <= 0) return null;
  const secs = Math.ceil(estimatedMs / 1000);
  const mins = Math.floor(secs / 60);
  const s = secs % 60;
  return mins > 0 ? `${mins}m ${s}s` : `${secs}s`;
}
