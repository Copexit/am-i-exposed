"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** Compact page header: title and badge, `aside` (the protocol switch) beside them from 1024 px, then a one-line description. */
export function ObservatoryPageHeader({ showMainnetBadge, aside, title, description }: { showMainnetBadge: boolean; aside?: ReactNode; title?: string; description?: string }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-y-1 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-x-8">
      <div className="flex items-center gap-3 flex-wrap lg:col-start-1 lg:row-start-1">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
          {title ?? t("observatory.pageTitle", { defaultValue: "CoinJoin Observatory" })}
        </h1>
        {showMainnetBadge && (
          <span className="text-[10px] font-semibold text-bitcoin/80 bg-bitcoin/10 px-2 py-0.5 rounded-full uppercase tracking-wider">
            {t("observatory.mainnetBadge", { defaultValue: "Mainnet" })}
          </span>
        )}
      </div>
      <p className="text-sm text-muted leading-relaxed text-pretty lg:col-span-2 lg:row-start-2">
        {description ?? t("observatory.pageDescription", {
          defaultValue:
            "Live activity for Bitcoin's two leading open-source CoinJoin protocols, sourced from independent community projects.",
        })}
      </p>
      {aside && <div className="mt-3 lg:mt-0 lg:col-start-2 lg:row-start-1">{aside}</div>}
    </div>
  );
}
