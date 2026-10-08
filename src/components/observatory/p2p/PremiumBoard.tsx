"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { BoardRow } from "@/lib/observatory/p2p/market";
import { VENUES, type Venue } from "@/lib/observatory/p2p/types";
import { fmtPremium } from "@/lib/observatory/p2p/p2p-format";
import { fmtCount } from "@/lib/observatory/obs-format";
import { CHIP, CHIP_OFF, CHIP_ON, DASH, VENUE_LABEL, VenueDot } from "./p2p-ui";

interface Props {
  rows: BoardRow[];
  side: "buy" | "sell";
  onSelect: (cur: string, venue: Venue) => void;
}

/** Best cell in the row for the visitor: lowest premium to buy, highest to sell. */
function bestOf(row: BoardRow, side: "buy" | "sell"): Venue | null {
  let best: Venue | null = null;
  for (const v of VENUES) {
    const m = row.cells[v].median;
    const b = best ? row.cells[best].median! : null;
    if (m !== null && (b === null || (side === "buy" ? m < b : m > b))) best = v;
  }
  // A lone price is not "best" of anything.
  return VENUES.filter((v) => row.cells[v].median !== null).length > 1 ? best : null;
}

/** Shade by distance from the row's best cell, with the severity tokens (never hex). */
function shade(m: number, best: number, side: "buy" | "sell"): string {
  const worse = side === "buy" ? m - best : best - m;
  return worse <= 1 ? "bg-surface-2 text-foreground" : worse <= 3 ? "bg-severity-medium/10 text-severity-medium" : "bg-severity-high/10 text-severity-high";
}

export function PremiumBoard({ rows, side, onSelect }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  const [mobileVenue, setMobileVenue] = useState<Venue>("robosats");
  if (!rows.length) return null;

  return (
    <div className="max-w-4xl space-y-3">
      <div role="group" aria-label={t("observatory.p2p.selector.venues", { defaultValue: "Venues" })} className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-surface-inset border border-card-border sm:hidden">
        {VENUES.map((v) => (
          <button key={v} type="button" aria-pressed={mobileVenue === v} onClick={() => setMobileVenue(v)} className={`${CHIP} justify-center ${mobileVenue === v ? CHIP_ON : CHIP_OFF}`}>
            <VenueDot venue={v} />
            {VENUE_LABEL[v]}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-hairline">
        <table className="w-full text-sm" data-testid="p2p-board">
          <caption className="sr-only">
            {side === "buy"
              ? t("observatory.p2p.board.captionBuy", { defaultValue: "Median premium to buy BTC, by currency and venue" })
              : t("observatory.p2p.board.captionSell", { defaultValue: "Median premium to sell BTC, by currency and venue" })}
          </caption>
          <thead className="bg-surface-inset text-xs text-faint">
            <tr>
              <th scope="col" className="px-3 py-2.5 text-left font-normal">{t("observatory.p2p.selector.currency", { defaultValue: "Currency" })}</th>
              {VENUES.map((v) => (
                <th key={v} scope="col" className={`px-3 py-2.5 text-right font-normal ${v === mobileVenue ? "" : "hidden sm:table-cell"}`}>
                  <span className="inline-flex items-center gap-1.5"><VenueDot venue={v} />{VENUE_LABEL[v]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const best = bestOf(row, side);
              const bestMedian = best ? row.cells[best].median : null;
              return (
                <tr key={row.currency} className="border-t border-hairline">
                  <th scope="row" className="num px-3 py-1.5 text-left font-medium text-foreground">{row.currency}</th>
                  {VENUES.map((v) => {
                    const cell = row.cells[v];
                    const hide = v === mobileVenue ? "" : "hidden sm:table-cell";
                    if (cell.median === null) {
                      return <td key={v} className={`px-3 py-1.5 text-right text-faint ${hide}`}>{DASH}</td>;
                    }
                    const isBest = v === best;
                    const tone = isBest ? "bg-severity-good/10 text-severity-good ring-1 ring-inset ring-severity-good/30" : shade(cell.median, bestMedian ?? cell.median, side);
                    return (
                      <td key={v} className={`px-1.5 py-1 text-right ${hide}`}>
                        <button
                          type="button"
                          data-testid={`p2p-cell-${row.currency}-${v}`}
                          data-best={isBest || undefined}
                          onClick={() => onSelect(row.currency, v)}
                          aria-label={t("observatory.p2p.board.cell", { defaultValue: "{{cur}} on {{venue}}: median {{premium}}, {{count}} offers", cur: row.currency, venue: VENUE_LABEL[v], premium: fmtPremium(cell.median, locale), count: cell.offers })}
                          className={`ml-auto flex min-h-10 w-full min-w-24 flex-col items-end justify-center rounded-lg px-2.5 py-1 transition-colors hover:ring-1 hover:ring-hairline-strong cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bitcoin ${tone}`}
                        >
                          <span className="num text-sm leading-tight">{fmtPremium(cell.median, locale)}</span>
                          <span className="num text-[11px] leading-tight text-faint">{fmtCount(cell.offers, locale)}</span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-faint">
        {t("observatory.p2p.board.note", { defaultValue: "Best cell per currency is outlined. Small figures are offer counts." })}
      </p>
    </div>
  );
}
