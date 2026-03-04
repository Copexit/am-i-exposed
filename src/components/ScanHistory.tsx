"use client";

import { useState, useCallback, useMemo, useRef, memo } from "react";
import { motion } from "motion/react";
import { Clock, Star, Lightbulb, X, Download, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RecentScans } from "./RecentScans";
import type { RecentScan } from "@/hooks/useRecentScans";
import type { Bookmark } from "@/hooks/useBookmarks";
import type { ExampleItem } from "@/lib/constants";
import { gradeColor, truncateId } from "@/lib/constants";

interface ScanHistoryProps {
  scans: RecentScan[];
  bookmarks: Bookmark[];
  examples?: ExampleItem[];
  onSelect: (input: string) => void;
  onClearScans?: () => void;
  onRemoveBookmark: (input: string) => void;
  onClearBookmarks: () => void;
  onExportBookmarks?: () => void;
  onImportBookmarks?: (json: string) => { imported: number; error?: string };
}

type Tab = "recent" | "bookmarks" | "examples";

export const ScanHistory = memo(function ScanHistory({
  scans,
  bookmarks,
  examples = [],
  onSelect,
  onClearScans,
  onRemoveBookmark,
  onClearBookmarks,
  onExportBookmarks,
  onImportBookmarks,
}: ScanHistoryProps) {
  const { t } = useTranslation();

  // Default tab: examples when no recents/bookmarks, else recent
  const defaultTab: Tab =
    scans.length === 0 && bookmarks.length === 0
      ? "examples"
      : scans.length === 0 && bookmarks.length > 0
        ? "bookmarks"
        : "recent";
  const [tab, setTab] = useState<Tab>(defaultTab);

  const [importFeedback, setImportFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onImportBookmarks) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = onImportBookmarks(reader.result as string);
      if (result.error) {
        setImportFeedback({ type: "error", message: t("history.importError", { defaultValue: "Invalid bookmark file" }) });
      } else {
        setImportFeedback({ type: "success", message: t("history.importSuccess", { defaultValue: "{{count}} bookmarks imported", count: result.imported }) });
      }
      setTimeout(() => setImportFeedback(null), 3000);
    };
    reader.readAsText(file);
    // Reset so same file can be re-imported
    e.target.value = "";
  }, [onImportBookmarks, t]);

  const handleClear = () => {
    if (tab === "recent" && onClearScans) {
      onClearScans();
    } else if (tab === "bookmarks") {
      onClearBookmarks();
    }
  };

  const showClear = tab === "recent" ? scans.length > 0 && onClearScans : tab === "bookmarks" ? bookmarks.length > 0 : false;

  const tabListRef = useRef<HTMLDivElement>(null);
  const availableTabs = useMemo<Tab[]>(() => examples.length > 0 ? ["recent", "bookmarks", "examples"] : ["recent", "bookmarks"], [examples.length]);

  const handleTabKeyDown = useCallback((e: React.KeyboardEvent) => {
    const idx = availableTabs.indexOf(tab);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (idx + 1) % availableTabs.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + availableTabs.length) % availableTabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = availableTabs.length - 1;
    if (next !== null) {
      e.preventDefault();
      const nextTab = availableTabs[next];
      setTab(nextTab);
      tabListRef.current?.querySelector<HTMLElement>(`#tab-${nextTab}`)?.focus();
    }
  }, [tab, availableTabs]);

  // Shuffle examples once on mount so Whirlpool variants don't cluster together
  const [shuffledExamples] = useState(() => {
    const arr = [...examples];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.3 }}
      className="w-full max-w-2xl"
    >
      {/* Tab bar */}
      <div className="flex items-center justify-between gap-2 mb-2 px-1">
        <div ref={tabListRef} className="flex items-center gap-3" role="tablist" aria-label={t("history.tabs", { defaultValue: "Scan history tabs" })} onKeyDown={handleTabKeyDown}>
          <button
            id="tab-recent"
            role="tab"
            aria-selected={tab === "recent"}
            aria-controls="panel-recent"
            tabIndex={tab === "recent" ? 0 : -1}
            onClick={() => setTab("recent")}
            className={`inline-flex items-center gap-1.5 text-xs transition-colors cursor-pointer pb-1 ${
              tab === "recent"
                ? "text-foreground border-b border-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            <Clock size={14} aria-hidden="true" />
            {t("history.recent", { defaultValue: "Recent" })}
            {scans.length > 0 && (
              <span className="text-muted">({scans.length})</span>
            )}
          </button>
          <button
            id="tab-bookmarks"
            role="tab"
            aria-selected={tab === "bookmarks"}
            aria-controls="panel-bookmarks"
            tabIndex={tab === "bookmarks" ? 0 : -1}
            onClick={() => setTab("bookmarks")}
            className={`inline-flex items-center gap-1.5 text-xs transition-colors cursor-pointer pb-1 ${
              tab === "bookmarks"
                ? "text-foreground border-b border-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            <Star size={14} aria-hidden="true" />
            {t("history.bookmarks", { defaultValue: "Bookmarks" })}
            {bookmarks.length > 0 && (
              <span className="text-muted">({bookmarks.length})</span>
            )}
          </button>
          {examples.length > 0 && (
            <button
              id="tab-examples"
              role="tab"
              aria-selected={tab === "examples"}
              aria-controls="panel-examples"
              tabIndex={tab === "examples" ? 0 : -1}
              onClick={() => setTab("examples")}
              className={`inline-flex items-center gap-1.5 text-xs transition-colors cursor-pointer pb-1 ${
                tab === "examples"
                  ? "text-foreground border-b border-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <Lightbulb size={14} aria-hidden="true" />
              {t("history.examples", { defaultValue: "Examples" })}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {tab === "bookmarks" && onImportBookmarks && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleImportFile}
                className="hidden"
                aria-hidden="true"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors cursor-pointer p-1"
                title={t("history.importBookmarks", { defaultValue: "Import bookmarks from JSON" })}
                aria-label={t("history.importBookmarks", { defaultValue: "Import bookmarks from JSON" })}
              >
                <Upload size={14} />
                <span className="hidden sm:inline">{t("history.import", { defaultValue: "Import" })}</span>
              </button>
            </>
          )}
          {tab === "bookmarks" && bookmarks.length > 0 && onExportBookmarks && (
            <button
              onClick={onExportBookmarks}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors cursor-pointer p-1"
              title={t("history.exportBookmarks", { defaultValue: "Export bookmarks as JSON" })}
              aria-label={t("history.exportBookmarks", { defaultValue: "Export bookmarks as JSON" })}
            >
              <Download size={14} />
              <span className="hidden sm:inline">{t("history.export", { defaultValue: "Export" })}</span>
            </button>
          )}
          {showClear && (
            <button
              onClick={handleClear}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors cursor-pointer p-1"
              title={tab === "recent"
                ? t("history.clearRecent", { defaultValue: "Clear recent scans" })
                : t("history.clearBookmarks", { defaultValue: "Clear bookmarks" })}
              aria-label={tab === "recent"
                ? t("history.clearRecent", { defaultValue: "Clear recent scans" })
                : t("history.clearBookmarks", { defaultValue: "Clear bookmarks" })}
            >
              <X size={14} />
              <span className="hidden sm:inline">{t("history.clear", { defaultValue: "Clear" })}</span>
            </button>
          )}
        </div>
      </div>

      {/* Tab content */}
      {tab === "recent" && (
        <div role="tabpanel" id="panel-recent" aria-labelledby="tab-recent">
        {scans.length === 0 ? (
          <p className="text-xs text-muted px-1">
            {t("history.noRecent", { defaultValue: "No recent scans yet. Try an example to get started." })}
          </p>
        ) : (
          <RecentScans scans={scans} onSelect={onSelect} hideHeader />
        )}
        </div>
      )}

      {tab === "bookmarks" && (
        <div role="tabpanel" id="panel-bookmarks" aria-labelledby="tab-bookmarks">
        {importFeedback && (
          <p className={`text-xs mb-2 px-1 ${importFeedback.type === "error" ? "text-red-400" : "text-green-400"}`} role="status">
            {importFeedback.message}
          </p>
        )}
        {bookmarks.length === 0 ? (
          <p className="text-xs text-muted px-1">
            {t("history.noBookmarks", { defaultValue: "No bookmarks yet. Save interesting scans from the results page." })}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {bookmarks.map((bm) => (
              <div
                key={bm.input}
                className="inline-flex items-center gap-2 px-3 py-2.5 rounded-lg bg-surface-elevated/50
                  border border-card-border hover:border-card-border hover:bg-surface-elevated
                  transition-all text-xs group"
              >
                <button
                  onClick={() => onSelect(bm.input)}
                  className="inline-flex items-center gap-2 cursor-pointer"
                >
                  <span className={`font-bold ${gradeColor(bm.grade)}`}>
                    {bm.grade}
                  </span>
                  {bm.label ? (
                    <span className="text-foreground truncate max-w-32">{bm.label}</span>
                  ) : (
                    <span className="font-mono text-muted group-hover:text-foreground transition-colors truncate max-w-32">
                      {truncateId(bm.input)}
                    </span>
                  )}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveBookmark(bm.input);
                  }}
                  className="text-muted hover:text-foreground transition-colors cursor-pointer p-2 -mr-2"
                  title={t("history.remove", { defaultValue: "Remove bookmark" })}
                  aria-label={t("history.remove", { defaultValue: "Remove bookmark" })}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        </div>
      )}

      {tab === "examples" && (
        <div role="tabpanel" id="panel-examples" aria-labelledby="tab-examples" className="relative">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {shuffledExamples.map((ex) => (
              <button
                key={ex.input}
                onClick={() => onSelect(ex.input)}
                className="inline-flex items-center gap-2 px-4 py-3 sm:py-2 rounded-lg bg-surface-elevated/50
                  border border-card-border hover:border-bitcoin/40 hover:bg-surface-elevated
                  transition-all text-sm cursor-pointer group shrink-0"
              >
                <span className="text-muted group-hover:text-foreground transition-colors whitespace-nowrap">
                  {t(ex.labelKey, { defaultValue: ex.labelDefault })}
                </span>
                <span className={`text-xs font-bold ${ex.hintColor}`}>
                  {ex.hint}
                </span>
              </button>
            ))}
          </div>
          <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-background to-transparent" />
        </div>
      )}
    </motion.div>
  );
});
