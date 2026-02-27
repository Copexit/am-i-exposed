"use client";

import { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { motion, AnimatePresence } from "motion/react";
import { Heart, X, Copy, Check, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { copyToClipboard } from "@/lib/clipboard";
import { LN_ADDRESS } from "@/lib/constants";
const DISMISS_KEY = "ami-tip-toast-dismissed";
const INLINE_DISMISS_KEY = "ami-tip-dismissed";

function isDismissed(): boolean {
  try {
    return (
      sessionStorage.getItem(DISMISS_KEY) === "1" ||
      sessionStorage.getItem(INLINE_DISMISS_KEY) === "1"
    );
  } catch {
    return false;
  }
}

function persistDismiss(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, "1");
  } catch {}
}

export function TipToast() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(isDismissed);
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(min-width: 1024px)").matches;
  });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (dismissed) return;

    const timer = setTimeout(() => setVisible(true), 3000);
    return () => clearTimeout(timer);
  }, [dismissed]);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await copyToClipboard(LN_ADDRESS);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    persistDismiss();
    setDismissed(true);
  };

  return (
    <AnimatePresence>
      {visible && !dismissed && (
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
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>

            {/* Expanded: QR + address */}
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
                      <div className="bg-white rounded-lg p-3">
                        <QRCodeSVG
                          value={`lightning:${LN_ADDRESS}`}
                          size={140}
                          level="M"
                          includeMargin={false}
                        />
                      </div>
                    </div>

                    <div className="text-center space-y-2">
                      <p className="text-xs text-muted">
                        {t("common.tipScanQR", { defaultValue: "Scan with any Lightning wallet, or copy the address below" })}
                      </p>
                      <div className="flex items-center justify-center gap-2">
                        <code className="text-xs text-bitcoin bg-bitcoin/10 px-2 py-1 rounded font-mono break-all">
                          {LN_ADDRESS}
                        </code>
                        <button
                          onClick={handleCopy}
                          className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors cursor-pointer px-2 py-2 rounded border border-card-border"
                        >
                          {copied ? <Check size={14} /> : <Copy size={14} />}
                          {copied ? t("common.copied", { defaultValue: "Copied" }) : t("common.copy", { defaultValue: "Copy" })}
                        </button>
                      </div>
                      <a
                        href="nostr:npub14n4e3dnxcumh7kexfgunp86dzhtjcfewe40g4qm6yfl3kf9ute2q5jqr48"
                        className="inline-flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors mt-1"
                      >
                        <Zap size={12} />
                        {t("common.zapNostr", { defaultValue: "Zap via Nostr" })}
                      </a>
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
