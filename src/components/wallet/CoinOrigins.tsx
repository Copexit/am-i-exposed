"use client";

import { useTranslation } from "react-i18next";
import { COIN_CLASSES, type CoinClass, type OriginCounts } from "@/lib/analysis/wallet-behavior";
import { fmtN } from "@/lib/format";

/** Segment colour per class: tokens only. */
const TONE: Record<CoinClass, string> = {
  mixed: "bg-severity-good",
  "coinjoin-change": "bg-severity-high",
  change: "bg-foreground/55",
  self: "bg-foreground/40",
  received: "bg-foreground/25",
  unknown: "bg-foreground/10",
};

const LABEL: Record<CoinClass, string> = {
  mixed: "Mixed (CoinJoin)",
  "coinjoin-change": "CoinJoin change",
  change: "Change",
  self: "Self-transfer",
  received: "Received",
  unknown: "Unknown origin",
};

/** Unspent coins by origin: a bar weighted by sats and a legend with counts. Every coin is in exactly one class. */
export function CoinOrigins({ origins }: { origins: OriginCounts }) {
  const { t } = useTranslation();
  const present = COIN_CLASSES.filter((c) => origins[c].count > 0);
  const totalCount = present.reduce((s, c) => s + origins[c].count, 0);
  const totalSats = present.reduce((s, c) => s + origins[c].sats, 0);
  if (totalCount === 0) return null;
  const label = (c: CoinClass) => t(`wallet.origin.${c}`, { defaultValue: LABEL[c] });
  const sats = t("common.sats", { defaultValue: "sats" });
  return (
    <div data-testid="coin-origins" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13px] text-muted">
        <span>{t("wallet.coinOrigins", { defaultValue: "Coin origins" })}</span>
        <span className="num">{t("flows.utxosAvailable", { count: totalCount, defaultValue: "{{count}} UTXOs" })}</span>
      </div>
      <div
        role="img"
        aria-label={t("wallet.coinOriginsAria", { count: totalCount, defaultValue: "{{count}} unspent coins by origin" })}
        className="flex h-2 w-full overflow-hidden rounded-full bg-surface-inset"
      >
        {present.map((c) => (
          // Every class with coins stays visible, however few sats it holds
          <span key={c} className={`${TONE[c]} min-w-1`} style={{ width: `${(origins[c].sats / totalSats) * 100}%` }} />
        ))}
      </div>
      {/* Items wrap as units; one item wider than the card wraps inside itself. */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted min-w-0">
        {present.map((c) => (
          <li key={c} className="flex flex-wrap items-center gap-x-1.5 min-w-0 max-w-full">
            <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${TONE[c]}`} />
            <span className="text-foreground">{label(c)}</span>
            <span className="num break-all">{fmtN(origins[c].count)} · {fmtN(origins[c].sats)} {sats}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
