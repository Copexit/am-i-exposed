/**
 * Shared type helpers for d3-sankey / @visx/sankey computed layout.
 *
 * After the Sankey layout runs, nodes gain x0/x1/y0/y1 and links gain
 * width/y0/y1 plus resolved source/target objects. The base d3-sankey types
 * mark these as optional (they don't exist pre-layout), so downstream render
 * code needs casts. These aliases make the casts explicit and consistent.
 */

import type { SankeyExtraProperties } from "d3-sankey";

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
