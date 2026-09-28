import type { Severity } from "@/lib/types";

/** Tailwind text classes per severity (semantic colors only). */
export const SEVERITY_TEXT: Record<Severity, string> = {
  critical: "text-severity-critical",
  high: "text-severity-high",
  medium: "text-severity-medium",
  low: "text-severity-low",
  good: "text-severity-good",
};

/** Tailwind background classes per severity (dots, stripes). */
export const SEVERITY_BG: Record<Severity, string> = {
  critical: "bg-severity-critical",
  high: "bg-severity-high",
  medium: "bg-severity-medium",
  low: "bg-severity-low",
  good: "bg-severity-good",
};
