/**
 * Shared type helpers for d3-sankey / @visx/sankey computed layout.
 *
 * After the Sankey layout runs, nodes gain x0/x1/y0/y1 and links gain
 * width/y0/y1 plus resolved source/target objects. The base d3-sankey types
 * mark these as optional (they don't exist pre-layout), so downstream render
 * code needs casts. These aliases make the casts explicit and consistent.
 */

import type { SankeyExtraProperties } from "d3-sankey";

// ---------------------------------------------------------------------------
// Base datum types shared between FlowChart and CoinJoinChart
// ---------------------------------------------------------------------------

/** Fields common to every Sankey node in this project. */
export interface BaseNodeDatum extends SankeyExtraProperties {
  id: string;
  label: string;
  fullAddress?: string;
  value: number;
  /** Known entity name for this address (exchange, darknet, etc.). */
  entityName?: string;
}

/** Link datum shared by both FlowChart and CoinJoinChart. */
export interface LinkDatum extends SankeyExtraProperties {
  source: string;
  target: string;
  value: number;
}

// ---------------------------------------------------------------------------
// Anon-set / denomination tier grouping (used by both charts)
// ---------------------------------------------------------------------------

/** Result of grouping output values into equal-value tiers and unique outputs. */
export interface DenomGrouping {
  valueCounts: Map<number, number>;
  /** Map from output value -> assigned color for tiers with 2+ equal outputs. */
  groupColors: Map<number, string>;
}

/**
 * Compute denomination tier grouping from output value counts.
 * Both FlowChart (anon-set coloring) and CoinJoinChart (tier nodes) use this.
 */
export function computeDenomGrouping(
  valueCounts: Map<number, number>,
  palette: readonly string[],
): DenomGrouping {
  const groupColors = new Map<number, string>();
  let ci = 0;
  for (const [value, count] of valueCounts) {
    const color = palette[ci % palette.length];
    if (count >= 2 && color !== undefined) {
      groupColors.set(value, color);
      ci++;
    }
  }
  return { valueCounts, groupColors };
}

// ---------------------------------------------------------------------------
// Computed layout types (post-Sankey)
// ---------------------------------------------------------------------------

/** Sankey node after layout computation (x0/x1/y0/y1 are always defined). */
export type SankeyComputedNode<N extends SankeyExtraProperties> = N & {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
};

/** Sankey link after layout computation (width/y0/y1 and resolved source/target). */
export type SankeyComputedLink<
  N extends SankeyExtraProperties,
  L extends SankeyExtraProperties,
> = L & {
  width: number;
  value: number;
  y0: number;
  y1: number;
  source: SankeyComputedNode<N> & { id: string; x1: number };
  target: SankeyComputedNode<N> & { id: string; x0: number };
};
