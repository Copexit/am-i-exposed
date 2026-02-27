import type { Grade } from "@/lib/types";

/** Lightning address for tips / Value4Value. */
export const LN_ADDRESS = "woozycuticle72@walletofsatoshi.com";

/** Whirlpool pool denominations in satoshis. */
export const WHIRLPOOL_DENOMS = [
  50_000, // 0.0005 BTC
  100_000, // 0.001 BTC
  1_000_000, // 0.01 BTC
  5_000_000, // 0.05 BTC
  50_000_000, // 0.5 BTC (retired 2023)
];

/** Grade-to-Tailwind text color mapping for use in components. */
export const GRADE_COLORS: Record<Grade, string> = {
  "A+": "text-severity-good",
  B: "text-severity-low",
  C: "text-severity-medium",
  D: "text-severity-high",
  F: "text-severity-critical",
};

/** Grade-to-Tailwind badge color mapping (background + text). */
export const GRADE_BADGE_COLORS: Record<Grade, string> = {
  "A+": "bg-severity-good/15 text-severity-good",
  B: "bg-severity-low/15 text-severity-low",
  C: "bg-severity-medium/15 text-severity-medium",
  D: "bg-severity-high/15 text-severity-high",
  F: "bg-severity-critical/15 text-severity-critical",
};

/** Grade-to-hex color mapping for Canvas/non-CSS contexts (share cards, glow effects). */
export const GRADE_HEX: Record<Grade, string> = {
  "A+": "#28d065",
  B: "#3b82f6",
  C: "#eab308",
  D: "#f97316",
  F: "#ef4444",
};

/** Look up grade text color, returning fallback for unknown grades. */
export function gradeColor(grade: string, fallback = "text-muted"): string {
  return GRADE_COLORS[grade as Grade] ?? fallback;
}

/** Look up grade badge color, returning fallback for unknown grades. */
export function gradeBadgeColor(grade: string, fallback = "text-muted"): string {
  return GRADE_BADGE_COLORS[grade as Grade] ?? fallback;
}

/** Truncate a string showing first 8 and last `tailLen` characters. */
export function truncateId(s: string, tailLen = 4): string {
  if (s.length <= 8 + tailLen + 3) return s;
  return `${s.slice(0, 8)}...${s.slice(-tailLen)}`;
}
