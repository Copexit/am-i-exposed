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

/** Unspent coins by origin: a bar weighted by sats and a legend with counts. */
export function CoinOrigins({ origins }: { origins: OriginCounts }) {
  const { t } = useTranslation();
  const present = COIN_CLASSES.filter((c) => origins[c].count > 0);
  const totalCount = present.reduce((s, c) => s + origins[c].count, 0);
  const totalSats = present.reduce((s, c) => s + origins[c].sats, 0);
  if (totalCount === 0) return null;
  const label = (c: CoinClass) => t(`wallet.origin.${c}`, { defaultValue: LABEL[c] });
  return (
    <div data-testid="coin-origins" className="space-y-2">
      <span className="text-[13px] text-muted">{t("wallet.coinOrigins", { defaultValue: "Coin origins" })}</span>
      <div
        role="img"
        aria-label={t("wallet.coinOriginsAria", { count: totalCount, defaultValue: "{{count}} unspent coins by origin" })}
        className="flex h-2 w-full overflow-hidden rounded-full bg-surface-inset"
      >
        {present.map((c) => (
          <span key={c} className={TONE[c]} style={{ width: `${totalSats > 0 ? (origins[c].sats / totalSats) * 100 : 100 / present.length}%` }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {present.map((c) => (
          <li key={c} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${TONE[c]}`} />
            <span className="text-foreground">{label(c)}</span>
            <span className="num">{fmtN(origins[c].count)} · {fmtN(origins[c].sats)} sats</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
