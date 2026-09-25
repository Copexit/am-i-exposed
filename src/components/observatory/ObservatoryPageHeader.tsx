"use client";

import { useTranslation } from "react-i18next";

export function ObservatoryPageHeader({ showMainnetBadge }: { showMainnetBadge: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
          {t("observatory.pageTitle", { defaultValue: "CoinJoin Observatory" })}
        </h1>
        {showMainnetBadge && (
          <span className="text-[10px] font-semibold text-bitcoin/80 bg-bitcoin/10 px-2 py-0.5 rounded-full uppercase tracking-wider">
            {t("observatory.mainnetBadge", { defaultValue: "Mainnet" })}
          </span>
        )}
      </div>
      <p className="text-muted text-lg leading-relaxed max-w-3xl">
        {t("observatory.pageDescription", {
          defaultValue:
            "Live activity for Bitcoin's two leading open-source CoinJoin protocols, sourced from independent community projects.",
        })}
      </p>
    </div>
  );
}
