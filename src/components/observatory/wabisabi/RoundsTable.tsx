"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useRounds } from "@/hooks/useWabisator";
import { fmtBtc, fmtCount } from "@/lib/observatory/obs-format";
import type { RoundsPage } from "@/lib/observatory/wabisator-types";
import { TXID_RE } from "@/lib/constants";
import { ObservatoryErrorState } from "@/components/observatory/ObservatoryErrorState";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bitcoin";
const BONE = "rounded bg-surface-2 motion-safe:animate-pulse";
const TH = "px-3 py-2.5 font-medium whitespace-nowrap";
const TD = "px-3 py-2 whitespace-nowrap";

/** `abcdef…7890`: the start and end of a txid, enough to recognise it. */
export const shortTxid = (txid: string) => (txid.length > 16 ? `${txid.slice(0, 8)}…${txid.slice(-6)}` : txid);

/** The coordinator's latest rounds, 25 a page, polled. The page number is owned by the caller. */
export function RoundsTable({ coordinatorKey, page, onPage }: { coordinatorKey: string; page: number; onPage: (page: number) => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  const rounds = useRounds(coordinatorKey, page);
  // While the next page loads, keep the previous one on screen (dimmed) instead of flashing skeletons.
  const [last, setLast] = useState<RoundsPage | null>(null);
  if (rounds.data && rounds.data !== last) setLast(rounds.data);
  const shown = rounds.data ?? last;
  const stale = !rounds.data && !!last;
  const time = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  // This page failed (another page may still be in `last`): say so rather than show stale rows as this page.
  const failed = !rounds.data && !!rounds.error;
  const blameInfo = t("observatory.wabisabi.rounds.blameInfo", { defaultValue: "Blame round: a retry after a previous round failed" });

  const totalPages = Math.max(1, shown?.TotalPages ?? 1);
  const cols = [
    { id: "time", label: t("observatory.wabisabi.rounds.time", { defaultValue: "Time" }), left: true },
    { id: "io", label: t("observatory.wabisabi.rounds.io", { defaultValue: "Inputs / outputs" }) },
    { id: "btc", label: "BTC" },
    { id: "anonset", label: t("observatory.wabisabi.rounds.anonset", { defaultValue: "Output anonset" }) },
    { id: "fee", label: t("observatory.wabisabi.rounds.fee", { defaultValue: "Fee rate" }) },
    { id: "fresh", label: t("observatory.wabisabi.rounds.fresh", { defaultValue: "Fresh BTC" }) },
    { id: "blame", label: t("observatory.wabisabi.rounds.blame", { defaultValue: "Round" }), left: true },
    { id: "tx", label: t("observatory.wabisabi.rounds.tx", { defaultValue: "Transaction" }), left: true },
  ];

  return (
    <div className="space-y-3">
      {failed ? (
        <ObservatoryErrorState source="wabisator" onRetry={rounds.refresh} locale={locale} />
      ) : (
        <div className="overflow-x-auto overscroll-x-contain rounded-xl border border-hairline">
          <table className="w-full min-w-[760px] text-sm" aria-busy={!rounds.data}>
            <caption className="sr-only">{t("observatory.wabisabi.rounds.caption", { defaultValue: "Recent rounds" })}</caption>
            <thead className="bg-surface-inset text-xs text-muted">
              <tr>
                {cols.map((c) => <th key={c.id} scope="col" className={`${TH} ${c.left ? "text-left" : "text-right"}`}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody className={`divide-y divide-hairline transition-opacity duration-200 ${stale ? "opacity-50" : ""}`}>
              {shown
                ? shown.Rounds.map((r) => (
                    <tr key={r.RoundId} className="transition-colors duration-150 hover:bg-surface-2/60">
                      <td className={`${TD} num text-muted`}>{time.format(Date.parse(r.RoundEndTime))}</td>
                      <td className={`${TD} num text-right`}>{fmtCount(r.InputCount, locale)} <span className="text-faint">/</span> {fmtCount(r.OutputCount, locale)}</td>
                      <td className={`${TD} num text-right font-medium text-foreground`}>{fmtBtc(r.TotalInputAmount / 1e8, locale)}</td>
                      <td className={`${TD} num text-right`}>{r.AverageStandardOutputsAnonSet.toLocaleString(locale, { maximumFractionDigits: 1 })}</td>
                      <td className={`${TD} num text-right`}>{r.FinalMiningFeeRate.toLocaleString(locale, { maximumFractionDigits: 2 })} <span className="text-[11px] text-muted">sat/vB</span></td>
                      <td className={`${TD} num text-right`}>{fmtBtc(r.FreshInputsEstimateBtc, locale)}</td>
                      <td className={TD}>
                        {r.IsBlame && (
                          <span role="img" title={blameInfo} aria-label={blameInfo} className="inline-flex cursor-help items-center rounded-md bg-surface-inset px-1.5 py-0.5 text-[11px] font-medium text-muted ring-1 ring-hairline">
                            {t("observatory.wabisabi.rounds.blameTag", { defaultValue: "Blame" })}
                          </span>
                        )}
                      </td>
                      <td className="px-1.5 py-0.5">
                        {TXID_RE.test(r.TxId) && (
                          <a
                            href={`/#tx=${r.TxId}`}
                            title={`${t("observatory.wabisabi.event.analyze", { defaultValue: "Analyze in am-i.exposed" })}: ${r.TxId}`}
                            className={`group inline-flex min-h-10 items-center gap-1.5 rounded-md px-1.5 font-mono text-xs text-muted transition-colors duration-200 hover:text-foreground ${FOCUS}`}
                          >
                            <span className="sr-only">{t("observatory.wabisabi.rounds.analyze", { defaultValue: "Analyze" })} </span>
                            {shortTxid(r.TxId)}
                            <ArrowUpRight size={13} aria-hidden="true" className="transition-transform duration-200 motion-safe:group-hover:-translate-y-px motion-safe:group-hover:translate-x-px" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))
                : Array.from({ length: 8 }, (_, i) => (
                    <tr key={i} aria-hidden="true">
                      {cols.map((c) => <td key={c.id} className="px-3 py-3.5"><span className={`block h-3.5 ${c.left ? "w-20" : "ml-auto w-14"} ${BONE}`} /></td>)}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}

      <nav aria-label={t("observatory.wabisabi.rounds.pagination", { defaultValue: "Rounds pages" })} className="flex flex-wrap items-center justify-between gap-3">
        <p className="num text-xs text-muted">
          {shown && t("observatory.wabisabi.rounds.total", { defaultValue: "{{formatted}} rounds in total", count: shown.TotalCount, formatted: fmtCount(shown.TotalCount, locale) })}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            aria-label={t("observatory.wabisabi.rounds.prev", { defaultValue: "Previous page" })}
            className={`inline-flex size-10 items-center justify-center rounded-lg text-muted transition-colors duration-200 hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-35 cursor-pointer ${FOCUS}`}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span className="num min-w-24 px-1 text-center text-sm text-foreground" aria-live="polite">
            {t("observatory.wabisabi.rounds.page", { defaultValue: "Page {{page}} of {{total}}", page: fmtCount(page, locale), total: fmtCount(totalPages, locale) })}
          </span>
          <button
            type="button"
            onClick={() => onPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            aria-label={t("observatory.wabisabi.rounds.next", { defaultValue: "Next page" })}
            className={`inline-flex size-10 items-center justify-center rounded-lg text-muted transition-colors duration-200 hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-35 cursor-pointer ${FOCUS}`}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </nav>
    </div>
  );
}
