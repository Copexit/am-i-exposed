"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { useNetwork } from "@/context/NetworkContext";
import { formatTimeAgo } from "@/lib/format";

interface ObservatoryAttributionProps {
  lastUpdatedAt: number | null;
  locale: string;
}

export function ObservatoryAttribution({
  lastUpdatedAt,
  locale,
}: ObservatoryAttributionProps) {
  const { t } = useTranslation();
  const { isUmbrel } = useNetwork();

  // The setter is only used to trigger a re-render every 15s so the
  // formatTimeAgo() output stays current.
  const [, bumpTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => bumpTick((t) => t + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const relative =
    lastUpdatedAt != null
      ? formatTimeAgo(Math.floor(lastUpdatedAt / 1000), locale)
      : null;

  return (
    <div className="rounded-xl border border-card-border bg-surface-elevated/50 p-5 space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          {t("observatory.attribution.poweredBy", {
            defaultValue: "Live data sourced from independent projects:",
          })}
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="https://whirlpool.observer"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-surface-inset border border-card-border text-foreground hover:border-bitcoin/30 transition-all"
          >
            {t("observatory.attribution.openWhirlpool", {
              defaultValue: "Open whirlpool.observer",
            })}
            <ExternalLink size={12} className="text-muted" />
          </a>
          <a
            href="https://liquisabi.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-surface-inset border border-card-border text-foreground hover:border-bitcoin/30 transition-all"
          >
            {t("observatory.attribution.openLiquiSabi", {
              defaultValue: "Open liquisabi.com",
            })}
            <ExternalLink size={12} className="text-muted" />
          </a>
        </div>
      </div>

      <div className="text-xs text-muted space-y-1">
        {relative && lastUpdatedAt != null && (
          <p>
            {t("observatory.attribution.lastUpdated", {
              defaultValue: "Last updated {{when}}.",
              when: relative,
            })}
          </p>
        )}
        {isUmbrel && (
          <p>
            {t("observatory.attribution.privacyUmbrel", {
              defaultValue:
                "Self-hosted: requests routed through the local Tor proxy. No data is sent to am-i.exposed.",
            })}
          </p>
        )}
      </div>
    </div>
  );
}
