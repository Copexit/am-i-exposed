"use client";

import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Heart, X, Copy, Check, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { copyToClipboard } from "@/lib/clipboard";
import { COINOS_PAY_URL } from "@/lib/constants";
const DISMISS_KEY = "ami-tip-toast-dismissed";

function getDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

const subscribeNoop = () => () => {};

function persistDismiss(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, "1");
  } catch { /* sessionStorage unavailable */ }
}

export function TipToast() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const sessionDismissed = useSyncExternalStore(subscribeNoop, getDismissed, () => false);
  const [localDismissed, setLocalDismissed] = useState(false);
  const dismissed = sessionDismissed || localDismissed;
  const [expanded, setExpanded] = useState(false);
  // Hide on lg+ where the inline TipJar is visible to avoid duplicate QR codes
  const isLargeScreen = useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia("(min-width: 1024px)");
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => false,
  );
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  useEffect(() => {
    if (dismissed || isLargeScreen) return;

    const timer = setTimeout(() => setVisible(true), 3000);
    return () => clearTimeout(timer);
  }, [dismissed, isLargeScreen]);

  // Auto-dismiss on mobile after 8 seconds (don't persist - show again next session)
  useEffect(() => {
    if (!visible || dismissed || expanded) return;
    const isMobile = typeof window !== "undefined" && window.innerWidth < 640;
    if (!isMobile) return;

    const timer = setTimeout(() => setVisible(false), 8000);
    return () => clearTimeout(timer);
  }, [visible, dismissed, expanded]);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await copyToClipboard(COINOS_PAY_URL);
    if (ok) {
      setCopied(true);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    persistDismiss();
    setLocalDismissed(true);
  };

  return (
    <AnimatePresence>
      {visible && !dismissed && !isLargeScreen && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.3 }}
          className="fixed bottom-4 sm:bottom-20 right-4 left-4 sm:left-auto max-w-sm z-50"
        >
          <div className="relative rounded-xl overflow-hidden border border-bitcoin/30" style={{ background: "var(--card-bg)", boxShadow: "var(--glass-shadow)" }}>
            {/* Collapsed row */}
            <button
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer group"
            >
              <Heart
                size={16}
                className="text-bitcoin shrink-0 group-hover:text-bitcoin/80 transition-colors"
              />
              <span className="text-sm text-muted group-hover:text-foreground transition-colors flex-1">
                {t("common.tipToastMessage", { defaultValue: "This tool is free and open source. Tip to keep it running." })}
              </span>
            </button>

            {/* Dismiss */}
            <button
              onClick={handleDismiss}
              className="absolute top-3 right-3 text-muted hover:text-foreground transition-colors cursor-pointer p-3"
              aria-label={t("common.dismiss", { defaultValue: "Dismiss" })}
            >
              <X size={16} />
            </button>

            {/* Expanded: tip button + address */}
            <AnimatePresence>
              {expanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 space-y-3">
                    <div className="border-t border-card-border pt-3" />

                    <div className="flex justify-center">
                      <a
                        href={COINOS_PAY_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-2 text-sm font-medium text-background bg-bitcoin hover:bg-bitcoin/90 transition-colors px-4 py-2.5 rounded-lg w-full"
                      >
                        <ExternalLink size={14} />
                        {t("common.tipViaCoinos", { defaultValue: "Tip via Bitcoin or Lightning" })}
                      </a>
                    </div>

                    <div className="flex items-center justify-center gap-2">
                      <a
                        href={COINOS_PAY_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-bitcoin hover:text-bitcoin/80 bg-bitcoin/10 px-2 py-1 rounded font-mono break-all transition-colors"
                      >
                        {COINOS_PAY_URL.replace("https://", "")}
                      </a>
                      <button
                        onClick={handleCopy}
                        className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors cursor-pointer px-2 py-2 rounded border border-card-border"
                      >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                        {copied ? t("common.copied", { defaultValue: "Copied" }) : t("common.copy", { defaultValue: "Copy" })}
                      </button>
                    </div>
                    <p className="text-center text-xs text-muted">
                      {t("common.v4v", { defaultValue: "Powered by Value4Value - no ads, no subscriptions, just voluntary support" })}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
