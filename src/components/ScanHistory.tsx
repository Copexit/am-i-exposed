"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Clock, Star, Lightbulb, X } from "lucide-react";
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
}

type Tab = "recent" | "bookmarks" | "examples";

export function ScanHistory({
  scans,
  bookmarks,
  examples = [],
  onSelect,
  onClearScans,
  onRemoveBookmark,
  onClearBookmarks,
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

  const handleClear = () => {
    if (tab === "recent" && onClearScans) {
      onClearScans();
    } else if (tab === "bookmarks") {
      onClearBookmarks();
    }
  };

  const showClear = tab === "recent" ? scans.length > 0 && onClearScans : tab === "bookmarks" ? bookmarks.length > 0 : false;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.3 }}
      className="w-full max-w-2xl"
    >
      {/* Tab bar */}
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-3" role="tablist" aria-label={t("history.tabs", { defaultValue: "Scan history tabs" })}>
          <button
            id="tab-recent"
            role="tab"
            aria-selected={tab === "recent"}
            aria-controls="panel-recent"
            onClick={() => setTab("recent")}
            className={`inline-flex items-center gap-1.5 text-xs transition-colors cursor-pointer pb-1 ${
              tab === "recent"
                ? "text-foreground border-b border-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            <Clock size={14} />
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
            onClick={() => setTab("bookmarks")}
            className={`inline-flex items-center gap-1.5 text-xs transition-colors cursor-pointer pb-1 ${
              tab === "bookmarks"
                ? "text-foreground border-b border-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            <Star size={14} />
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
              onClick={() => setTab("examples")}
              className={`inline-flex items-center gap-1.5 text-xs transition-colors cursor-pointer pb-1 ${
                tab === "examples"
                  ? "text-foreground border-b border-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <Lightbulb size={14} />
              {t("history.examples", { defaultValue: "Examples" })}
            </button>
          )}
        </div>

        {showClear && (
          <button
            onClick={handleClear}
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors cursor-pointer p-2 -m-2"
            title={tab === "recent"
              ? t("history.clearRecent", { defaultValue: "Clear recent scans" })
              : t("history.clearBookmarks", { defaultValue: "Clear bookmarks" })}
            aria-label={tab === "recent"
              ? t("history.clearRecent", { defaultValue: "Clear recent scans" })
              : t("history.clearBookmarks", { defaultValue: "Clear bookmarks" })}
          >
            <X size={14} />
            {t("history.clear", { defaultValue: "Clear" })}
          </button>
        )}
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
                  className="text-muted hover:text-foreground transition-colors cursor-pointer p-0.5 -mr-1"
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
        <div role="tabpanel" id="panel-examples" aria-labelledby="tab-examples" className="flex flex-wrap gap-2 justify-center">
          {examples.map((ex) => (
            <button
              key={ex.input}
              onClick={() => onSelect(ex.input)}
              className="inline-flex items-center gap-2 px-4 py-3 sm:py-2 rounded-lg bg-surface-elevated/50
                border border-card-border hover:border-bitcoin/40 hover:bg-surface-elevated
                transition-all text-sm cursor-pointer group"
            >
              <span className="text-muted group-hover:text-foreground transition-colors">
                {t(ex.labelKey, { defaultValue: ex.labelDefault })}
              </span>
              <span className={`text-xs font-bold ${ex.hintColor}`}>
                {ex.hint}
              </span>
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}
