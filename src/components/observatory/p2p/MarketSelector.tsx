"use client";

import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import type { Market, Venue } from "@/lib/observatory/p2p/types";
import { VENUES } from "@/lib/observatory/p2p/types";
import { marketOrder } from "@/lib/observatory/p2p/market";
import { fmtCount } from "@/lib/observatory/obs-format";
import { CHIP, CHIP_OFF, CHIP_ON, VENUE_LABEL, VenueDot } from "./p2p-ui";

export interface MarketPatch { cur?: string; side?: "buy" | "sell"; venue?: Venue[] }

interface Props {
  markets: Map<string, Market>;
  cur: string | null;
  side: "buy" | "sell";
  venues: Venue[];
  onChange: (patch: MarketPatch) => void;
}

const TOP = 8;

/** Currency chips (top 8 plus a native "More" select), the Buy / Sell intent and the venue filter. */
export function MarketSelector({ markets, cur, side, venues, onChange }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  const order = marketOrder(markets);
  const top = order.slice(0, TOP);
  // The selected market stays visible as a chip even when it is not in the top 8.
  const chips = cur && !top.includes(cur) ? [...top.slice(0, TOP - 1), cur] : top;
  const more = [...order].sort((a, b) => a.localeCompare(b));

  return (
    <div className="space-y-3">
      <div
        role="group"
        aria-label={t("observatory.p2p.selector.intent", { defaultValue: "What do you want to do?" })}
        className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-surface-inset border border-card-border sm:inline-grid sm:w-auto"
      >
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={side === s}
            onClick={() => onChange({ side: s })}
            className={`${CHIP} justify-center px-4 font-medium ${side === s ? CHIP_ON : CHIP_OFF}`}
          >
            {s === "buy"
              ? t("observatory.p2p.selector.buy", { defaultValue: "I want to buy BTC" })
              : t("observatory.p2p.selector.sell", { defaultValue: "I want to sell BTC" })}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <ul
            aria-label={t("observatory.p2p.selector.currency", { defaultValue: "Currency" })}
            className="-mx-4 flex min-w-0 gap-1 overflow-x-auto px-4 no-scrollbar sm:mx-0 sm:px-0"
          >
            {chips.map((c) => (
              <li key={c}>
                <button
                  type="button"
                  aria-pressed={cur === c}
                  onClick={() => onChange({ cur: c })}
                  className={`${CHIP} num ${cur === c ? CHIP_ON : `${CHIP_OFF} hover:bg-surface-2`}`}
                >
                  {c}
                  <span className="text-[11px] text-faint">{fmtCount(markets.get(c)?.offers.length ?? 0, locale)}</span>
                </button>
              </li>
            ))}
          </ul>
          {more.length > TOP && (
            <label className="relative shrink-0">
              <span className="sr-only">{t("observatory.p2p.selector.more", { defaultValue: "More currencies" })}</span>
              <select
                value={cur && !chips.includes(cur) ? cur : ""}
                onChange={(e) => e.target.value && onChange({ cur: e.target.value })}
                className="num h-10 appearance-none rounded-lg border border-hairline bg-surface-inset pl-3 pr-8 text-sm text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bitcoin cursor-pointer"
              >
                <option value="">{t("observatory.p2p.selector.moreOption", { defaultValue: "More" })}</option>
                {more.map((c) => (
                  <option key={c} value={c}>{`${c} (${fmtCount(markets.get(c)?.offers.length ?? 0, locale)})`}</option>
                ))}
              </select>
              <ChevronDown size={14} aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-faint" />
            </label>
          )}
        </div>

        <ul aria-label={t("observatory.p2p.selector.venues", { defaultValue: "Venues" })} className="flex flex-wrap gap-1">
          {VENUES.map((v) => {
            const on = venues.includes(v);
            const last = on && venues.length === 1;
            return (
              <li key={v}>
                <button
                  type="button"
                  aria-pressed={on}
                  aria-disabled={last || undefined}
                  title={last ? t("observatory.p2p.selector.lastVenue", { defaultValue: "At least one venue stays selected" }) : undefined}
                  onClick={() => { if (!last) onChange({ venue: on ? venues.filter((x) => x !== v) : VENUES.filter((x) => x === v || venues.includes(x)) }); }}
                  className={`${CHIP} border ${on ? "border-hairline-strong bg-surface-2 text-foreground" : "border-hairline text-faint hover:text-foreground"} ${last ? "cursor-default" : ""}`}
                >
                  <VenueDot venue={v} className={`size-2 transition-opacity ${on ? "" : "opacity-30"}`} />
                  {VENUE_LABEL[v]}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
