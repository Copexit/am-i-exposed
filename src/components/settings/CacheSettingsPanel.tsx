"use client";

import { Database, Star, Trash2, X } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { idbCount, idbClear } from "@/lib/api/idb-cache";
import { useAnalysisSettings } from "@/hooks/useAnalysisSettings";
import { clearSavedWallets, forgetWallet, listSavedWallets, type SavedWalletMeta } from "@/lib/wallet/saved-wallets";
import { formatSize, formatTimeAgo } from "@/lib/format";
import { useBookmarks } from "@/hooks/useBookmarks";

export function CacheSettingsPanel() {
  const { t, i18n } = useTranslation();
  const { settings, update } = useAnalysisSettings();
  const [count, setCount] = useState<number | null>(null);
  const [wallets, setWallets] = useState<SavedWalletMeta[]>([]);
  const [clearing, setClearing] = useState(false);
  const { bookmarks, removeWalletBookmarks } = useBookmarks();
  const walletBookmarks = bookmarks.filter((b) => b.type === "wallet");
  const bookmarkFor = (key: string) => walletBookmarks.find((b) => b.snapshotKey === key);

  const refreshCount = useCallback(() => {
    idbCount().then(setCount).catch(() => setCount(0));
    void listSavedWallets().then(setWallets);
  }, []);

  useEffect(() => {
    refreshCount();
  }, [refreshCount]);

  const handleClear = async () => {
    setClearing(true);
    try {
      await Promise.all([idbClear(), clearSavedWallets()]);
      setCount(0);
      setWallets([]);
    } catch {
      // Silently fail
    } finally {
      setClearing(false);
    }
  };

  const handleToggle = async () => {
    const newValue = !settings.enableCache;
    update({ enableCache: newValue });
    if (!newValue) {
      // Auto-clear cache when disabling
      await handleClear();
    }
  };

  return (
    <div className="border-t border-card-border pt-3 mt-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Database size={12} className="text-muted" />
          <span className="text-xs font-medium text-foreground uppercase tracking-wider">
            {t("settings.cacheTitle", { defaultValue: "API Cache" })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {settings.enableCache && count !== null && (
            <span className="text-xs font-mono text-muted tabular-nums">
              {t("settings.cacheEntries", {
                count,
                defaultValue: "{{count}} entries",
              })}
            </span>
          )}
          {settings.enableCache && (
            <button
              onClick={handleClear}
              disabled={clearing || (count === 0 && wallets.length === 0)}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 size={12} />
              {t("settings.cacheClear", { defaultValue: "Clear" })}
            </button>
          )}
        </div>
      </div>

      {/* Enable/disable toggle */}
      <label className="flex items-center justify-between gap-2 cursor-pointer group mt-2">
        <span className="text-xs text-muted group-hover:text-foreground transition-colors">
          {t("settings.enableCache", { defaultValue: "Persist cache across sessions" })}
        </span>
        <button
          role="switch"
          aria-checked={settings.enableCache}
          onClick={handleToggle}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors after:absolute after:-inset-1 after:content-[''] ${
            settings.enableCache ? "bg-bitcoin" : "bg-surface-inset"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-foreground shadow-sm transition-transform ${
              settings.enableCache ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </label>

      {settings.enableCache && wallets.length > 0 && (
        <div className="mt-2">
          <span className="text-xs text-muted">{t("settings.savedWallets", { defaultValue: "Saved wallets" })}</span>
          <ul className="mt-1 space-y-0.5" data-testid="saved-wallets">
            {wallets.map((w) => (
              <li key={w.key} className="flex items-center gap-2 text-[11px] text-muted">
                <span className="font-mono text-foreground" title={t("settings.savedWalletId", { defaultValue: "Wallet ID (a hash, not the key)" })}>{w.key.slice(0, 8)}</span>
                {bookmarkFor(w.key) && (
                  <span className="inline-flex items-center gap-0.5 text-bitcoin" title={t("settings.bookmarked", { defaultValue: "Bookmarked" })}>
                    <Star size={10} className="fill-bitcoin" aria-label={t("settings.bookmarked", { defaultValue: "Bookmarked" })} />
                    {bookmarkFor(w.key)?.label}
                  </span>
                )}
                <span className="flex-1 min-w-0 truncate">
                  {w.scriptType} · {w.backend.split("@")[0]} · {formatTimeAgo(Math.floor(w.scannedAt / 1000), i18n.language)} · {formatSize(w.size)}
                </span>
                <button
                  type="button"
                  onClick={async () => { await forgetWallet(w.key); refreshCount(); }}
                  aria-label={t("wallet.saved.forget", { defaultValue: "Forget this wallet" })}
                  title={t("wallet.saved.forget", { defaultValue: "Forget this wallet" })}
                  className="p-1 -m-1 rounded text-muted hover:text-foreground cursor-pointer"
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {walletBookmarks.length > 0 && (
        <button
          type="button"
          onClick={removeWalletBookmarks}
          className="mt-2 inline-flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors cursor-pointer"
        >
          <Trash2 size={12} />
          {t("settings.removeWalletBookmarks", { count: walletBookmarks.length, defaultValue: "Remove all wallet bookmarks ({{count}})" })}
        </button>
      )}

      <p className="text-[10px] text-muted/60 mt-1">
        {settings.enableCache
          ? t("settings.cacheNote", {
              defaultValue:
                "Fetched blockchain data is stored locally in your browser. No data is sent to any server. Clear or disable at any time.",
            })
          : t("settings.cacheDisabledNote", {
              defaultValue:
                "Cache is disabled. Data is only kept in memory for the current session.",
            })}
      </p>
    </div>
  );
}
