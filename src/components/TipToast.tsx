"use client";

import { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { motion, AnimatePresence } from "motion/react";
import { Heart, X, Copy, Check } from "lucide-react";

const LN_ADDRESS = "woozycuticle72@walletofsatoshi.com";
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
    try {
      await navigator.clipboard.writeText(LN_ADDRESS);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
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
          className="fixed bottom-20 right-4 left-4 sm:left-auto max-w-sm z-50"
        >
          <div className="relative bg-surface-elevated border border-bitcoin/30 rounded-xl shadow-xl overflow-hidden">
            {/* Collapsed row */}
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer group"
            >
              <Heart
                size={16}
                className="text-bitcoin shrink-0 group-hover:text-bitcoin/80 transition-colors"
              />
              <span className="text-sm text-muted group-hover:text-foreground transition-colors flex-1">
                This tool is free and open source. Tip to keep it running.
              </span>
            </button>

            {/* Dismiss */}
            <button
              onClick={handleDismiss}
              className="absolute top-3 right-3 text-muted hover:text-foreground transition-colors cursor-pointer p-0.5"
              aria-label="Dismiss"
            >
              <X size={12} />
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
                        Scan with any Lightning wallet, or copy the address below
                      </p>
                      <div className="flex items-center justify-center gap-2">
                        <code className="text-xs text-bitcoin bg-bitcoin/10 px-2 py-1 rounded font-mono break-all">
                          {LN_ADDRESS}
                        </code>
                        <button
                          onClick={handleCopy}
                          className="inline-flex items-center gap-1 text-[10px] text-muted hover:text-foreground transition-colors cursor-pointer px-2 py-0.5 rounded border border-card-border"
                        >
                          {copied ? <Check size={10} /> : <Copy size={10} />}
                          {copied ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>
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
