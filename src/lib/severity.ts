/**
 * Shared severity-level styling constants used across multiple components.
 *
 * These use semantic Tailwind tokens (severity-*) defined in globals.css.
 * For SVG/Canvas contexts, use SVG_COLORS from viz/shared/svgConstants instead.
 */

import type { Severity } from "@/lib/types";

/** Severity-keyed border + background classes (for cards/panels with borders). */
export const SEVERITY_COLORS: Record<Severity, string> = {
  critical: "border-severity-critical/40 bg-severity-critical/5",
  high: "border-severity-high/40 bg-severity-high/5",
  medium: "border-severity-medium/40 bg-severity-medium/5",
  low: "border-severity-low/40 bg-severity-low/5",
  good: "border-severity-good/40 bg-severity-good/5",
};

/** Severity-keyed dot/indicator background classes. */
export const SEVERITY_DOT: Record<Severity, string> = {
  critical: "bg-severity-critical",
  high: "bg-severity-high",
  medium: "bg-severity-medium",
  low: "bg-severity-low",
  good: "bg-severity-good",
};

/** Severity-keyed text color classes. */
export const SEVERITY_TEXT: Record<Severity, string> = {
  critical: "text-severity-critical",
  high: "text-severity-high",
  medium: "text-severity-medium",
  low: "text-severity-low",
  good: "text-severity-good",
};

/** Severity-keyed background + border classes (for chain analysis cards). */
export const SEVERITY_BG: Record<Severity, string> = {
  critical: "bg-severity-critical/10 border-severity-critical/20",
  high: "bg-severity-high/10 border-severity-high/20",
  medium: "bg-severity-medium/10 border-severity-medium/20",
  low: "bg-severity-low/10 border-severity-low/20",
  good: "bg-severity-good/10 border-severity-good/20",
};
