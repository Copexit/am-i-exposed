"use client";

import { useState, useRef, useEffect } from "react";
import { Star } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { useBookmarks } from "@/hooks/useBookmarks";
import type { InputType } from "@/lib/types";

const PRIVACY_DISMISSED_KEY = "bookmark-privacy-dismissed";

interface BookmarkButtonProps {
  query: string;
  inputType: InputType;
  grade: string;
  score: number;
}

export function BookmarkButton({ query, inputType, grade, score }: BookmarkButtonProps) {
  const { t } = useTranslation();
  const { isBookmarked, addBookmark, removeBookmark, updateLabel } = useBookmarks();
  const saved = isBookmarked(query);
  const [showLabel, setShowLabel] = useState(false);
  const [labelValue, setLabelValue] = useState("");
  const [showPrivacy, setShowPrivacy] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showLabel && labelRef.current) {
      labelRef.current.focus();
    }
  }, [showLabel]);

  const handleClick = () => {
    if (saved) {
      removeBookmark(query);
      return;
    }

    // Check if privacy notice needs showing
    const dismissed = localStorage.getItem(PRIVACY_DISMISSED_KEY);
    if (!dismissed) {
      setShowPrivacy(true);
      return;
    }

    doBookmark();
  };

  const doBookmark = () => {
    addBookmark({
      input: query,
      type: inputType === "txid" ? "txid" : "address",
      grade,
      score,
    });
    setShowLabel(true);
  };

  const handlePrivacyDismiss = () => {
    localStorage.setItem(PRIVACY_DISMISSED_KEY, "1");
    setShowPrivacy(false);
    doBookmark();
  };

  const handleLabelConfirm = () => {
    if (labelValue.trim()) {
      updateLabel(query, labelValue.trim());
    }
    setShowLabel(false);
    setLabelValue("");
  };

  const handleLabelSkip = () => {
    setShowLabel(false);
    setLabelValue("");
  };

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg border border-card-border
          hover:border-muted/50 bg-surface-elevated/50 text-sm transition-all cursor-pointer"
        title={saved
          ? t("bookmark.saved", { defaultValue: "Saved" })
          : t("bookmark.save", { defaultValue: "Save" })}
        aria-label={saved
          ? t("bookmark.saved", { defaultValue: "Saved" })
          : t("bookmark.save", { defaultValue: "Save" })}
      >
        <Star
          size={16}
          className={saved ? "text-bitcoin fill-bitcoin" : "text-muted"}
        />
        <span className={saved ? "text-bitcoin" : "text-muted"}>
          {saved
            ? t("bookmark.saved", { defaultValue: "Saved" })
            : t("bookmark.save", { defaultValue: "Save" })}
        </span>
      </button>

      <AnimatePresence>
        {showPrivacy && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute right-0 top-full mt-2 z-50 w-64 rounded-lg border border-card-border bg-surface-elevated p-3 shadow-lg"
          >
            <p className="text-xs text-muted leading-relaxed mb-2">
              {t("bookmark.privacyNote", { defaultValue: "Bookmarks persist in local storage. Clear anytime." })}
            </p>
            <button
              onClick={handlePrivacyDismiss}
              className="text-xs text-bitcoin hover:text-bitcoin-hover transition-colors cursor-pointer font-medium"
            >
              {t("bookmark.understand", { defaultValue: "Got it" })}
            </button>
          </motion.div>
        )}

        {showLabel && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute right-0 top-full mt-2 z-50 w-64 rounded-lg border border-card-border bg-surface-elevated p-3 shadow-lg"
          >
            <label className="text-xs text-muted block mb-1">
              {t("bookmark.addLabel", { defaultValue: "Add a label (optional)" })}
            </label>
            <input
              ref={labelRef}
              type="text"
              value={labelValue}
              onChange={(e) => setLabelValue(e.target.value.slice(0, 40))}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleLabelConfirm();
                if (e.key === "Escape") handleLabelSkip();
              }}
              placeholder="e.g. Whirlpool test"
              maxLength={40}
              className="w-full px-2 py-1.5 rounded border border-card-border bg-surface-inset text-sm text-foreground
                placeholder:text-muted/50 focus:outline-none focus:border-bitcoin/50"
            />
            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={handleLabelSkip}
                className="text-xs text-muted hover:text-foreground transition-colors cursor-pointer"
              >
                Skip
              </button>
              <button
                onClick={handleLabelConfirm}
                className="text-xs text-bitcoin hover:text-bitcoin-hover transition-colors cursor-pointer font-medium"
              >
                Save
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
