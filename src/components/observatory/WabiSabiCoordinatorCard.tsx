"use client";

import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { fmtN } from "@/lib/format";
import type { CoordinatorView } from "@/lib/observatory/types";

interface WabiSabiCoordinatorCardProps {
  coordinator: CoordinatorView;
  /** Average standard inputs anon-set across all rounds (from dashboard.Summary). */
  avgAnonIn: number | null;
  /** Average standard outputs anon-set across all rounds (from dashboard.Summary). */
  avgAnonOut: number | null;
}

export function WabiSabiCoordinatorCard({
  coordinator,
  avgAnonIn,
  avgAnonOut,
}: WabiSabiCoordinatorCardProps) {
  const { t } = useTranslation();
  const isInactive = coordinator.roundCount === 0;
  return (
    <div
      className={`rounded-xl border border-card-border bg-surface-elevated/50 p-5 space-y-3 ${
        isInactive ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-foreground">
            {coordinator.name}
          </h3>
          <p className="text-xs text-muted truncate">
            {coordinator.endpoint}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {coordinator.isPaid && (
            <span className="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide bg-amber-500/15 text-amber-300 border border-amber-500/30">
              {t("observatory.wabisabi.paidBadge", { defaultValue: "Paid" })}
            </span>
          )}
          {isInactive && (
            <span className="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide bg-muted/10 text-muted border border-card-border">
              {t("observatory.wabisabi.inactiveBadge", {
                defaultValue: "Idle 30d",
              })}
            </span>
          )}
        </div>
      </div>

      <p className="text-sm text-muted leading-relaxed line-clamp-3">
        {coordinator.description}
      </p>

      <div className="grid grid-cols-2 gap-3 text-sm pt-1">
        <Stat
          label={t("observatory.wabisabi.freshShare", {
            defaultValue: "Fresh-input share",
          })}
          value={`${coordinator.freshInputPercent.toFixed(2)}%`}
        />
        <Stat
          label={t("observatory.wabisabi.roundCount", {
            defaultValue: "Rounds (30d)",
          })}
          value={fmtN(coordinator.roundCount)}
        />
        <Stat
          label={t("observatory.wabisabi.avgAnonIn", {
            defaultValue: "Avg anon-set in",
          })}
          value={avgAnonIn != null ? avgAnonIn.toFixed(2) : "-"}
        />
        <Stat
          label={t("observatory.wabisabi.avgAnonOut", {
            defaultValue: "Avg anon-set out",
          })}
          value={avgAnonOut != null ? avgAnonOut.toFixed(2) : "-"}
        />
      </div>

      {coordinator.readMore && (
        <a
          href={coordinator.readMore}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-bitcoin transition-colors"
        >
          {t("observatory.wabisabi.readMore", { defaultValue: "Read more" })}
          <ExternalLink size={11} />
        </a>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="text-base font-medium text-foreground tabular-nums">
        {value}
      </div>
    </div>
  );
}
