"use client";

import { ExternalLink, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatTimeAgo } from "@/lib/format";

interface ObservatoryErrorStateProps {
  /** Which upstream this card represents (selects copy + link). */
  source: "whirlpool" | "liquisabi";
  /** Unix-ms timestamp of the last successful fetch, if any. */
  staleAt?: number | null;
  locale?: string;
}

const SOURCE_URLS: Record<"whirlpool" | "liquisabi", string> = {
  whirlpool: "https://www.whirlpoolstats.xyz",
  liquisabi: "https://liquisabi.com",
};

const SOURCE_LABELS: Record<
  "whirlpool" | "liquisabi",
  { sourceKey: string; sourceDefault: string }
> = {
  whirlpool: {
    sourceKey: "observatory.attribution.openWhirlpool",
    sourceDefault: "Open whirlpoolstats.xyz",
  },
  liquisabi: {
    sourceKey: "observatory.attribution.openLiquiSabi",
    sourceDefault: "Open liquisabi.com",
  },
};

export function ObservatoryErrorState({
  source,
  staleAt,
  locale = "en",
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
  );
}
