"use client";

import { useTranslation } from "react-i18next";
import type { Severity } from "@/lib/types";

const SEVERITY_BG: Record<Severity, string> = {
  critical: "bg-severity-critical",
  high: "bg-severity-high",
  medium: "bg-severity-medium",
  low: "bg-severity-low",
  good: "bg-severity-good",
};

export interface ChecksStripProps {
  /** Number of engine checks (one cell each, in engine order). */
  total: number;
  /** Cells [0, done) are filled. */
  done: number;
  /** Severity color of a done cell, or null for a neutral "done" fill. */
  highlight?: (i: number) => Severity | null;
  /** Caption next to the eyebrow (e.g. the running check's name). */
  label?: string;
  /** Index of the check running now (gets a soft pulse). */
  current?: number;
}

/**
 * A row of cells, one per engine check, that fills as checks complete.
 * Used by the scan view (live engine steps) and by the results verdict
 * during the reveal (timeline.checksDone).
 */
export function ChecksStrip({ total, done, highlight, label, current }: ChecksStripProps) {
  const { t } = useTranslation();
  const n = Math.max(0, total);
  const filled = Math.max(0, Math.min(n, done));

  return (
    <div className="w-full" data-testid="checks-strip">
      <div className="flex items-baseline justify-between gap-3 mb-2.5">
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="v2-eyebrow shrink-0">{t("v2.scan.checks", { defaultValue: "Checks" })}</span>
          {label && <span className="text-[13px] text-muted truncate">{label}</span>}
        </div>
        <span className="v2-num text-[13px] text-muted shrink-0">
          <span className="text-foreground">{filled}</span>
          <span className="text-faint"> / {n}</span>
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={n}
        aria-valuenow={filled}
        aria-label={t("v2.scan.checksProgress", { done: filled, total: n, defaultValue: "{{done}} of {{total}} checks complete" })}
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, maxWidth: n * 30 }}
      >
        {Array.from({ length: n }, (_, i) => {
          const sev = i < filled ? highlight?.(i) ?? null : null;
          const cls = i < filled
            ? sev ? SEVERITY_BG[sev] : "bg-foreground/[0.16]"
            : i === current ? "bg-bitcoin/70 motion-safe:animate-pulse" : "bg-surface-2 ring-1 ring-inset ring-hairline";
          return <span key={i} className={`h-3.5 sm:h-5 rounded-[3px] transition-colors duration-200 ${cls}`} />;
        })}
      </div>
    </div>
  );
}
