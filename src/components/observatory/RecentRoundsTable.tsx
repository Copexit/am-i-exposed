"use client";

import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { fmtN } from "@/lib/format";
import type { RoundRow } from "@/lib/observatory/types";

interface RecentRoundsTableProps {
  rows: RoundRow[];
  /** Lifetime round count reported by LiquiSabi (`PaginatedRounds.TotalCount`). */
  total: number;
}

function truncTxid(txid: string): string {
  return txid.length > 20 ? `${txid.slice(0, 10)}…${txid.slice(-10)}` : txid;
}

export function RecentRoundsTable({ rows, total }: RecentRoundsTableProps) {
  const { t, i18n } = useTranslation();
  if (rows.length === 0) return null;

  const fmt = new Intl.DateTimeFormat(i18n.language || "en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="rounded-xl border border-card-border bg-surface-elevated/50 overflow-hidden">
      <div className="flex items-baseline justify-between gap-2 flex-wrap px-4 py-3 border-b border-card-border">
        <h3 className="text-sm font-medium text-foreground">
          {t("observatory.rounds.title", { defaultValue: "Recent rounds" })}
        </h3>
        {total > 0 && (
          <span className="text-xs text-muted tabular-nums">
            {t("observatory.cycles.showing", {
              defaultValue: "{{shown}} of {{total}}",
              shown: fmtN(rows.length),
              total: fmtN(total),
            })}
          </span>
        )}
      </div>

      <ul className="divide-y divide-card-border">
        {rows.map((row) => (
          <li key={row.txid}>
            <a
              href={row.scanHref}
              className="flex items-center gap-3 px-4 py-3 hover:bg-surface-elevated/80 transition-colors group"
            >
              <span className="text-xs text-muted tabular-nums whitespace-nowrap shrink-0 w-[6.5rem] sm:w-28">
                {row.endedAt != null ? (
                  <time dateTime={new Date(row.endedAt).toISOString()}>
                    {fmt.format(row.endedAt)}
                  </time>
                ) : (
                  "-"
                )}
              </span>
              <span className="text-xs text-muted truncate shrink-0 w-20 sm:w-32 min-w-0">
                {row.coordinatorName}
              </span>
              <span className="font-mono text-xs text-foreground/80 truncate flex-1 min-w-0">
                {truncTxid(row.txid)}
              </span>
              <span className="text-[11px] text-muted tabular-nums shrink-0 hidden sm:inline">
                {t("observatory.rounds.inOut", {
                  defaultValue: "in {{inputs}} · out {{outputs}}",
                  inputs: fmtN(row.inputCount),
                  outputs: fmtN(row.outputCount),
                })}
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-muted group-hover:text-bitcoin transition-colors shrink-0">
                <Search size={12} aria-hidden />
                <span className="hidden sm:inline">
                  {t("observatory.cycles.scan", { defaultValue: "Scan" })}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
