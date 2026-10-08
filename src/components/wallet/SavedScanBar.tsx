"use client";

import { useTranslation } from "react-i18next";
import { History, Loader2, RotateCcw, Trash2 } from "lucide-react";
import type { SavedStatus } from "@/hooks/useWalletAnalysis";
import { MAX_SNAPSHOT_BYTES } from "@/lib/wallet/saved-wallets";
import { formatSize, formatTimeAgo, fmtN } from "@/lib/format";

/** Saved-wallet status line: when the shown scan was fetched, refresh state, full rescan, forget. */
export function SavedScanBar({ saved, saveError, onFullRescan, onForget }: {
  saved: SavedStatus | null;
  saveError: { code: "tooLarge" | "quota"; size: number } | null;
  onFullRescan?: () => void;
  onForget?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const ago = saved ? formatTimeAgo(Math.floor(saved.scannedAt / 1000), i18n.language) : "";
  const savedFrom = t("wallet.saved.from", { ago, defaultValue: "Saved scan from {{ago}}" });

  const text = !saved ? null
    : saved.status === "refreshing" ? `${savedFrom} · ${t("wallet.saved.refreshing", { defaultValue: "Refreshing..." })}`
    : saved.status === "failed" ? `${savedFrom} · ${t("wallet.saved.failed", { defaultValue: "Refresh failed. The saved scan is shown." })}`
    : saved.status === "updated" ? t("wallet.saved.updated", { count: saved.newTxs, n: fmtN(saved.newTxs), defaultValue: "Updated: {{n}} new transactions" })
    : saved.status === "upToDate" ? t("wallet.saved.upToDate", { defaultValue: "Up to date" })
    : t("wallet.saved.saved", { defaultValue: "Saved on this device" });

  const btn = "inline-flex items-center gap-1.5 min-h-[36px] px-2 rounded-md text-muted hover:text-foreground hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
      {text && (
        <span data-testid="saved-scan-status" data-status={saved?.status} role="status" className="inline-flex items-center gap-2 text-muted min-w-0">
          {saved?.status === "refreshing"
            ? <Loader2 size={14} aria-hidden="true" className="shrink-0 animate-spin" />
            : <History size={14} aria-hidden="true" className="shrink-0" />}
          <span>{text}</span>
        </span>
      )}
      {saveError && (
        <span role="status" className="text-severity-medium">
          {saveError.code === "tooLarge"
            ? t("wallet.saved.tooLarge", { size: formatSize(saveError.size), limit: formatSize(MAX_SNAPSHOT_BYTES), defaultValue: "Not saved: this wallet's data is {{size}}, above the {{limit}} limit." })
            : t("wallet.saved.quota", { defaultValue: "Not saved: the browser's storage is full." })}
        </span>
      )}
      {saved && (
        <span className="inline-flex items-center gap-1 -mx-2">
          {onFullRescan && (
            <button type="button" onClick={onFullRescan} className={btn}>
              <RotateCcw size={13} aria-hidden="true" />
              {t("wallet.saved.fullRescan", { defaultValue: "Full rescan" })}
            </button>
          )}
          {onForget && (
            <button type="button" onClick={onForget} className={btn}>
              <Trash2 size={13} aria-hidden="true" />
              {t("wallet.saved.forget", { defaultValue: "Forget this wallet" })}
            </button>
          )}
        </span>
      )}
    </div>
  );
}
