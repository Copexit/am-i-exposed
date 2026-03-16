"use client";

import { Database, Trash2 } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { idbCount, idbClear } from "@/lib/api/idb-cache";
import { useAnalysisSettings } from "@/hooks/useAnalysisSettings";

export function CacheSettingsPanel() {
  const { t } = useTranslation();
  const { settings, update } = useAnalysisSettings();
  const [count, setCount] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);

  const refreshCount = useCallback(() => {
    idbCount().then(setCount).catch(() => setCount(0));
  }, []);

  useEffect(() => {
    refreshCount();
  }, [refreshCount]);

  const handleClear = async () => {
    setClearing(true);
    try {
      await idbClear();
      setCount(0);
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
              disabled={clearing || count === 0}
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
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
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
