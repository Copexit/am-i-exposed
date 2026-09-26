"use client";

import { useTranslation } from "react-i18next";
import type { Finding } from "@/lib/types";
import type { ScoreWaterfall } from "@/lib/view/waterfall";
import { findingKeys } from "@/lib/finding-utils";
import { GRADE_TEXT_VAR, GRADE_VAR } from "@/lib/constants";
import { scoreToGrade } from "@/lib/scoring/score";
import { SEVERITY_BG } from "./severity";

interface ScoreBreakdownProps {
  waterfall: ScoreWaterfall;
  findings: Finding[];
  /** Findings revealed so far (all, once the reveal is done). */
  isRevealed: (findingId: string) => boolean;
  highlightId: string | null;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
  /** Visible findings with no score impact (listed with the evidence). */
  zeroImpactCount: number;
}

/**
 * Where the score went: base, each finding's real impact in order, the clamp
 * (if the raw total left 0-100) and the final score. Hover links to findings.
 */
export function ScoreBreakdown({ waterfall, findings, isRevealed, highlightId, onHover, onOpen, zeroImpactCount }: ScoreBreakdownProps) {
  const { t } = useTranslation();
  const byId = new Map(findings.map((f) => [f.id as string, f]));
  const lo = Math.min(0, ...waterfall.steps.map((s) => Math.min(s.from, s.to)));
  const hi = Math.max(100, ...waterfall.steps.map((s) => Math.max(s.from, s.to)));
  const pct = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const zeroImpact = zeroImpactCount;
  const finalColor = GRADE_VAR[scoreToGrade(waterfall.final)];

  const bar = (from: number, to: number, cls: string, style?: React.CSSProperties) => (
    <div className="relative h-2 rounded-full bg-surface-2 overflow-hidden">
      <div className={`absolute top-0 bottom-0 rounded-full ${cls}`} style={{ left: `${pct(Math.min(from, to))}%`, width: `${Math.max(0.8, pct(Math.max(from, to)) - pct(Math.min(from, to)))}%`, ...style }} />
      {hi > 100 && <div className="absolute top-0 bottom-0 w-px bg-faint/60" style={{ left: `${pct(100)}%` }} aria-hidden="true" />}
    </div>
  );

  return (
    <section aria-labelledby="v2-breakdown-title" className="v2-panel space-y-4" data-testid="v2-score-breakdown">
      <div>
        <p className="v2-eyebrow mb-2">{t("v2.results.breakdownEyebrow", { defaultValue: "Score breakdown" })}</p>
        <h3 id="v2-breakdown-title" className="text-base font-semibold">{t("v2.results.breakdownTitle", { defaultValue: "Where the score went" })}</h3>
      </div>
      <ol className="space-y-2.5">
        <li className="grid grid-cols-[minmax(0,1fr)_2.5rem] gap-3 items-center">
          <div className="space-y-1.5">
            <div className="text-xs text-muted">{t("export.baseScore", { defaultValue: "Base score" })}</div>
            {bar(0, waterfall.base, "bg-faint/70")}
          </div>
          <span className="v2-num text-sm text-right">{waterfall.base}</span>
        </li>
        {waterfall.steps.map((s) => {
          const f = byId.get(s.findingId);
          const label = f ? t(findingKeys(f.id, "title", f.params), { ...f.params, defaultValue: f.title }) : s.findingId;
          const shown = isRevealed(s.findingId);
          const dim = highlightId !== null && highlightId !== s.findingId;
          return (
            <li key={s.findingId} className={`transition-opacity duration-300 ${shown ? (dim ? "opacity-40" : "opacity-100") : "opacity-0"}`}>
              <button
                type="button"
                onMouseEnter={() => onHover(s.findingId)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(s.findingId)}
                onBlur={() => onHover(null)}
                onClick={() => onOpen(s.findingId)}
                className="w-full grid grid-cols-[minmax(0,1fr)_2.5rem] gap-3 items-center text-left rounded-md hover:bg-surface-2/60 -mx-1.5 px-1.5 py-1 transition-colors"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="text-xs text-muted truncate">{label}</div>
                  {bar(s.from, s.to, s.impact > 0 ? "bg-severity-good" : SEVERITY_BG[s.severity])}
                </div>
                <span className={`v2-num text-sm text-right ${s.impact > 0 ? "text-severity-good" : "text-foreground"}`}>{s.impact > 0 ? `+${s.impact}` : s.impact}</span>
              </button>
            </li>
          );
        })}
        {waterfall.clamped && (
          <li className="grid grid-cols-[minmax(0,1fr)_2.5rem] gap-3 items-center">
            <div className="text-xs text-muted">
              {t("v2.results.clamped", { raw: waterfall.raw, defaultValue: "Total {{raw}}, capped to the 0-100 range" })}
            </div>
            <span className="v2-num text-sm text-right text-faint">{waterfall.final - waterfall.raw > 0 ? `+${waterfall.final - waterfall.raw}` : waterfall.final - waterfall.raw}</span>
          </li>
        )}
        <li className="grid grid-cols-[minmax(0,1fr)_2.5rem] gap-3 items-center pt-2 border-t border-hairline">
          <div className="space-y-1.5">
            <div className="text-xs text-foreground">{t("export.finalScore", { defaultValue: "Final score" })}</div>
            {bar(0, waterfall.final, "", { backgroundColor: finalColor })}
          </div>
          <span className="v2-num text-sm text-right" style={{ color: GRADE_TEXT_VAR[scoreToGrade(waterfall.final)] }}>{waterfall.final}</span>
        </li>
      </ol>
      {zeroImpact > 0 && (
        <p className="text-xs text-faint">{t("v2.results.zeroImpact", { count: zeroImpact, defaultValue: "{{count}} more findings carry no score impact and are listed with the evidence." })}</p>
      )}
    </section>
  );
}
