"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { fmtN } from "@/lib/format";
import { useNetwork } from "@/context/NetworkContext";
import { getObservatoryEndpoints } from "@/lib/observatory/endpoints";
import { getWhirlpoolTxs } from "@/lib/observatory/whirlpool-client";
import { toCycleRows } from "@/lib/observatory/selectors";
import type { CycleRow, WhirlpoolTxsPage } from "@/lib/observatory/types";

interface RecentCyclesTableProps {
  /** First page of cycle history from the observatory hook (null if it failed). */
  firstPage: WhirlpoolTxsPage | null;
}

function truncTxid(txid: string): string {
  return txid.length > 20 ? `${txid.slice(0, 10)}…${txid.slice(-10)}` : txid;
}

export function RecentCyclesTable({ firstPage }: RecentCyclesTableProps) {
  const { t } = useTranslation();
  const { isUmbrel } = useNetwork();
  const [extra, setExtra] = useState<WhirlpoolTxsPage[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  // Tracks the current base page so an in-flight "load more" can detect a
  // mid-load refresh and drop its (now stale) result instead of appending it.
  const firstPageRef = useRef(firstPage);

  // When the base page refreshes (focus revalidation), drop appended pages.
  useEffect(() => {
    firstPageRef.current = firstPage;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset appended pages when base page refreshes
    setExtra([]);
  }, [firstPage]);

  const allPages = firstPage ? [firstPage, ...extra] : [];
  // Dedup by txid: pagination can shift between fetches (a new cycle lands
  // mid-paging), which would otherwise yield a duplicate React key.
  const rows: CycleRow[] = [];
  const seen = new Set<string>();
  for (const page of allPages) {
    for (const row of toCycleRows(page)) {
      if (seen.has(row.txid)) continue;
      seen.add(row.txid);
      rows.push(row);
    }
  }
  const lastPage = allPages[allPages.length - 1] ?? null;
  const total = firstPage?.total ?? 0;
  const canLoadMore =
    lastPage != null && lastPage.page < lastPage.total_pages && !loadingMore;

  /* eslint-disable react-hooks/preserve-manual-memoization -- ref read guards stale in-flight pages */
  const loadMore = useCallback(async () => {
    if (!lastPage) return;
    const base = firstPageRef.current;
    setLoadingMore(true);
    try {
      const endpoints = getObservatoryEndpoints({ isUmbrel });
      const next = await getWhirlpoolTxs(endpoints.whirlpoolBase, lastPage.page + 1);
      // The base page refreshed while this was in flight - discard the stale page.
      if (firstPageRef.current !== base) return;
      setExtra((prev) => [...prev, next]);
    } catch {
      // Silently stop; the "load more" button just stays available to retry.
    } finally {
      setLoadingMore(false);
    }
  }, [isUmbrel, lastPage]);
  /* eslint-enable react-hooks/preserve-manual-memoization */

  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-card-border bg-surface-elevated/50 overflow-hidden">
      <div className="flex items-baseline justify-between gap-2 flex-wrap px-4 py-3 border-b border-card-border">
        <h3 className="text-sm font-medium text-foreground">
          {t("observatory.cycles.title", { defaultValue: "Recent cycles" })}
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
              <span className="text-xs text-muted tabular-nums shrink-0 w-20">
                #{fmtN(row.blockHeight)}
              </span>
              <span className="flex items-center gap-1.5 shrink-0 w-28 min-w-0">
                <span
                  className="inline-block h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: row.poolColor }}
                  aria-hidden
                />
                <span className="text-xs text-muted truncate">{row.poolLabel}</span>
              </span>
              <span className="font-mono text-xs text-foreground/80 truncate flex-1 min-w-0">
                {truncTxid(row.txid)}
              </span>
              <span className="text-[11px] text-muted tabular-nums shrink-0 hidden sm:inline">
                {t("observatory.cycles.tx0Count", {
                  defaultValue: "{{n}} TX0",
                  n: fmtN(row.tx0Count),
                })}
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-muted group-hover:text-bitcoin transition-colors shrink-0">
                <Search size={12} />
                <span className="hidden sm:inline">
                  {t("observatory.cycles.scan", { defaultValue: "Scan" })}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>

      {canLoadMore && (
        <div className="px-4 py-3 border-t border-card-border">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="w-full text-xs font-medium text-muted hover:text-bitcoin transition-colors disabled:opacity-50"
          >
            {loadingMore
              ? t("observatory.cycles.loading", { defaultValue: "Loading…" })
              : t("observatory.cycles.loadMore", { defaultValue: "Load more cycles" })}
          </button>
        </div>
      )}
    </div>
  );
}
