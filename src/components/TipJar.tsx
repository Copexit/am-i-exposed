"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { motion, AnimatePresence } from "motion/react";
import { Heart, ChevronDown, X, Copy, Check } from "lucide-react";

const LN_ADDRESS = "woozycuticle72@walletofsatoshi.com";
const DISMISS_KEY = "ami-tip-dismissed";

function isDismissedInSession(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function persistDismiss(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, "1");
  } catch {}
}

export function TipJar() {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(isDismissedInSession);
  const [copied, setCopied] = useState(false);

  if (dismissed) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(LN_ADDRESS);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.5 }}
      className="w-full relative rounded-xl border border-card-border bg-card-bg/50 overflow-hidden"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer group"
      >
        <Heart
          size={16}
          className="text-bitcoin shrink-0 group-hover:text-bitcoin/80 transition-colors"
        />
        <span className="text-sm text-muted group-hover:text-foreground transition-colors flex-1">
          am-i.exposed is free and open source. If it helped you, consider a tip.
        </span>
        <ChevronDown
          size={14}
          className={`text-muted shrink-0 transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      <button
        onClick={(e) => {
          e.stopPropagation();
          persistDismiss();
          setDismissed(true);
        }}
        className="absolute top-3 right-3 text-muted hover:text-foreground transition-colors cursor-pointer p-0.5"
        aria-label="Dismiss tip jar"
      >
        <X size={12} />
      </button>

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
                    size={160}
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
    </motion.div>
  );
}
