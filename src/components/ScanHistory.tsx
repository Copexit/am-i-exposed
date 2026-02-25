"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Clock, Star, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RecentScans } from "./RecentScans";
import type { RecentScan } from "@/hooks/useRecentScans";
import type { Bookmark } from "@/hooks/useBookmarks";

const GRADE_COLORS: Record<string, string> = {
  "A+": "text-severity-good",
  B: "text-severity-low",
  C: "text-severity-medium",
  D: "text-severity-high",
  F: "text-severity-critical",
};

interface ScanHistoryProps {
  scans: RecentScan[];
  bookmarks: Bookmark[];
  onSelect: (input: string) => void;
  onClearScans?: () => void;
  onRemoveBookmark: (input: string) => void;
  onClearBookmarks: () => void;
}

type Tab = "recent" | "bookmarks";

export function ScanHistory({
  scans,
  bookmarks,
  onSelect,
  onClearScans,
  onRemoveBookmark,
  onClearBookmarks,
}: ScanHistoryProps) {
  const { t } = useTranslation();

  // Default tab: bookmarks if scans empty but bookmarks exist
  const defaultTab: Tab = scans.length === 0 && bookmarks.length > 0 ? "bookmarks" : "recent";
  const [tab, setTab] = useState<Tab>(defaultTab);

  // If both empty, render nothing
  if (scans.length === 0 && bookmarks.length === 0) return null;

  const handleClear = () => {
    if (tab === "recent" && onClearScans) {
      onClearScans();
    } else if (tab === "bookmarks") {
      onClearBookmarks();
    }
  };

  const showClear = tab === "recent" ? scans.length > 0 && onClearScans : bookmarks.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.3 }}
      className="w-full max-w-2xl"
    >
      {/* Tab bar */}
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-3">
          <button
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
        <RecentScans scans={scans} onSelect={onSelect} hideHeader />
      )}

      {tab === "bookmarks" && (
        bookmarks.length === 0 ? (
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
                  <span className={`font-bold ${GRADE_COLORS[bm.grade] ?? "text-muted"}`}>
                    {bm.grade}
                  </span>
                  {bm.label ? (
                    <span className="text-foreground truncate max-w-32">{bm.label}</span>
                  ) : (
                    <span className="font-mono text-muted group-hover:text-foreground transition-colors truncate max-w-32">
                      {truncate(bm.input)}
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
        )
      )}
    </motion.div>
  );
}

function truncate(s: string): string {
  if (s.length <= 16) return s;
  return `${s.slice(0, 8)}...${s.slice(-4)}`;
}
