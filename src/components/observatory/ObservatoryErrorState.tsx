"use client";

import { ExternalLink, RotateCw, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatTimeAgo } from "@/lib/format";

interface ObservatoryErrorStateProps {
  /** Which upstream this card represents (selects copy + link). */
  source: Source;
  /** Unix-ms timestamp of the last successful fetch, if any. */
  staleAt?: number | null;
  locale?: string;
  /** Shows a retry button when given. */
  onRetry?: () => void;
}

type Source = "whirlpool" | "wabisator";

const SOURCE_URLS: Record<Source, string> = {
  whirlpool: "https://whirlpoolstats.xyz",
  wabisator: "https://wabisator.com",
};

const SOURCE_LABELS: Record<Source, { sourceKey: string; sourceDefault: string }> = {
  whirlpool: {
    sourceKey: "observatory.attribution.openWhirlpool",
    sourceDefault: "Open whirlpoolstats.xyz",
  },
  wabisator: {
    sourceKey: "observatory.attribution.openWabisator",
    sourceDefault: "Open wabisator.com",
  },
};

export function ObservatoryErrorState({
  source,
  staleAt,
  locale = "en",
  onRetry,
}: ObservatoryErrorStateProps) {
  const { t } = useTranslation();
  const meta = SOURCE_LABELS[source];
  const staleRelative =
    staleAt != null ? formatTimeAgo(Math.floor(staleAt / 1000), locale) : null;

  return (
    <div className="rounded-xl border border-card-border bg-surface-elevated/40 p-6 space-y-3">
      <div className="flex items-center gap-2 text-muted">
        <WifiOff size={16} />
        <span className="text-sm font-medium">
          {staleRelative
            ? t("observatory.errors.stale", {
                defaultValue:
                  "Live source unreachable. Last successful fetch {{when}}.",
                when: staleRelative,
              })
            : t("observatory.errors.unreachable", {
                defaultValue: "Live data is not available right now.",
              })}
        </span>
      </div>
      <div className="flex flex-wrap gap-3">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 min-h-10 text-sm px-3 py-2 rounded-lg bg-surface-inset border border-card-border text-foreground hover:border-bitcoin/30 transition-all cursor-pointer"
          >
            <RotateCw size={12} className="text-muted" aria-hidden="true" />
            {t("observatory.errors.retry", { defaultValue: "Try again" })}
          </button>
        )}
        <a
          href={SOURCE_URLS[source]}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-surface-inset border border-card-border text-foreground hover:border-bitcoin/30 transition-all"
        >
          {t(meta.sourceKey, { defaultValue: meta.sourceDefault })}
          <ExternalLink size={12} className="text-muted" />
        </a>
      </div>
    </div>
  );
}
