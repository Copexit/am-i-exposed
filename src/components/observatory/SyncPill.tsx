"use client";

import { useTranslation } from "react-i18next";

interface SyncPillProps {
  lagBlocks: number | null;
  upstreamBlock: number | null;
}

export function SyncPill({ lagBlocks, upstreamBlock }: SyncPillProps) {
  const { t } = useTranslation();
  if (upstreamBlock == null) return null;
  if (lagBlocks == null) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-muted/10 text-muted border border-card-border">
        {t("observatory.whirlpool.atBlock", {
          defaultValue: "Block {{block}}",
          block: upstreamBlock.toLocaleString("en-US"),
        })}
      </span>
    );
  }
  const fresh = lagBlocks <= 6;
  const cls = fresh
    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
    : "bg-amber-500/15 text-amber-300 border-amber-500/30";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${cls}`}>
      {fresh
        ? t("observatory.whirlpool.nearTip", {
            defaultValue: "Block {{block}} · in sync",
            block: upstreamBlock.toLocaleString("en-US"),
          })
        : t("observatory.whirlpool.behindTip", {
            defaultValue: "Block {{block}} · {{lag}} blocks behind tip",
            block: upstreamBlock.toLocaleString("en-US"),
            lag: lagBlocks.toLocaleString("en-US"),
          })}
    </span>
  );
}
