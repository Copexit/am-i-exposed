"use client";

import { useState, useEffect, useCallback } from "react";
import { Check, Loader2, Database } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getFilterStatus,
  getFullFilterStatus,
  isFullFilterLoaded,
  getFilter,
  loadEntityFilter,
  loadFullEntityFilter,
  checkForFullDataUpdate,
  updateFullEntityData,
} from "@/lib/analysis/entity-filter";

interface EntityFilterStatusProps {
  proMode: boolean;
}

export function EntityFilterStatus({ proMode }: EntityFilterStatusProps) {
  const { t } = useTranslation();
  const [, forceUpdate] = useState(0);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  // Auto-load core entity filter when settings panel renders
  useEffect(() => { void loadEntityFilter().then(() => forceUpdate((n) => n + 1)); }, []);

  // Check for full data updates when full filter is loaded
  useEffect(() => {
    if (!isFullFilterLoaded()) return;
    // Fire-and-forget: the callee catches its own errors.
    void checkForFullDataUpdate().then((available) => {
      if (available) setUpdateAvailable(true);
    });
  }, []);

  const coreStatus = getFilterStatus();
  const fullStatus = getFullFilterStatus();
  const fullLoaded = isFullFilterLoaded();
  const filter = getFilter();
  const addressCount = filter?.meta.addressCount ?? 0;
  const buildDate = filter?.meta.buildDate ?? "";

  const handleLoadFull = useCallback(async () => {
    setLoading(true);
    setProgress({ loaded: 0, total: 0 });
    try {
      await loadFullEntityFilter((loaded, total) => {
        setProgress({ loaded, total });
      });
    } catch {
      // silently fail - filter is optional
    }
    setLoading(false);
    setProgress(null);
    forceUpdate((n) => n + 1);
  }, []);

  const handleUpdateFull = useCallback(async () => {
    setLoading(true);
    setProgress({ loaded: 0, total: 0 });
    try {
      await updateFullEntityData((loaded, total) => {
        setProgress({ loaded, total });
      });
      setUpdateAvailable(false);
    } catch {
      // silently fail
    }
    setLoading(false);
    setProgress(null);
    forceUpdate((n) => n + 1);
  }, []);

  // Don't show if no core filter available
  if (coreStatus === "unavailable" || coreStatus === "error") return null;

  const statusColor =
    coreStatus === "ready" ? "text-success" : coreStatus === "loading" ? "text-bitcoin" : "text-muted";

  const isDownloading = loading || fullStatus === "loading";
  const pct = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
    : null;
  const loadedMB = progress ? (progress.loaded / 1_048_576).toFixed(1) : null;
  const totalMB = progress && progress.total > 0 ? (progress.total / 1_048_576).toFixed(0) : null;

  return (
    <div className="border-t border-card-border pt-2 space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <Database size={12} />
        <span>{t("settings.entityFilter", { defaultValue: "Entity Database" })}</span>
        <span className={`ml-auto text-[10px] ${statusColor}`}>
          {coreStatus === "ready"
            ? fullLoaded
              ? t("settings.entityFull", { defaultValue: "Full" })
              : t("settings.entityCore", { defaultValue: "Core" })
            : coreStatus === "loading"
              ? t("settings.entityLoading", { defaultValue: "Loading..." })
              : t("settings.entityIdle", { defaultValue: "Idle" })}
        </span>
      </div>

      {coreStatus === "ready" && (
        <div className="space-y-2">
          <p className="text-[10px] text-muted/60">
            {addressCount.toLocaleString()} {t("settings.entityAddresses", { defaultValue: "addresses" })}
            {buildDate ? ` - ${buildDate.slice(0, 10)}` : ""}
          </p>

          <p className="text-[10px] text-muted/50 leading-relaxed">
            {t("settings.entityExplainer", {
              defaultValue: "Every address in your transactions is cross-referenced locally against a database of known exchanges, services, and sanctioned entities. Nothing leaves your browser.",
            })}
          </p>

          {proMode && !fullLoaded && fullStatus !== "unavailable" && !isDownloading && (
            <button
              onClick={handleLoadFull}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-medium rounded-lg bg-bitcoin/10 text-bitcoin border border-bitcoin/20 hover:bg-bitcoin/20 hover:border-bitcoin/40 transition-all cursor-pointer"
            >
              <Database size={14} />
              {t("settings.entityLoadFull", { defaultValue: "Load full database (30M+ addresses)" })}
            </button>
          )}

          {isDownloading && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-bitcoin flex items-center gap-1.5">
                  <Loader2 size={10} className="animate-spin" />
                  {t("settings.entityDownloading", { defaultValue: "Downloading..." })}
                </span>
                <span className="text-muted tabular-nums">
                  {pct !== null
                    ? `${loadedMB} / ${totalMB} MB (${pct}%)`
                    : loadedMB
                      ? `${loadedMB} MB`
                      : ""}
                </span>
              </div>
              <div className="w-full h-1.5 bg-surface-inset rounded-full overflow-hidden">
                <div
                  className="h-full bg-bitcoin rounded-full transition-all duration-300 ease-out"
                  style={{ width: pct !== null ? `${pct}%` : "30%", animation: pct === null ? "pulse 2s ease-in-out infinite" : undefined }}
                />
              </div>
            </div>
          )}

          {fullLoaded && !updateAvailable && (
            <div className="flex items-center gap-1.5 text-[10px] text-success/80">
              <Check size={12} />
              {t("settings.entityFullLoaded", { defaultValue: "Full entity database loaded" })}
            </div>
          )}

          {fullLoaded && updateAvailable && !isDownloading && (
            <button
              onClick={handleUpdateFull}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-medium rounded-lg bg-bitcoin/10 text-bitcoin border border-bitcoin/20 hover:bg-bitcoin/20 hover:border-bitcoin/40 transition-all cursor-pointer"
            >
              <Database size={14} />
              {t("settings.entityUpdateAvailable", { defaultValue: "Update to latest database" })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
