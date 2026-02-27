"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { motion, AnimatePresence } from "motion/react";
import { Heart, ChevronDown, Copy, Check, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { copyToClipboard } from "@/lib/clipboard";
import { LN_ADDRESS } from "@/lib/constants";
export function TipJar() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(min-width: 1024px)").matches;
  });
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(LN_ADDRESS);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.5 }}
      className="w-full relative rounded-xl overflow-hidden border border-glass-border"
      style={{ background: "var(--card-bg)", boxShadow: "var(--glass-shadow)" }}
    >
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
          {t("common.tipMessage", { defaultValue: "am-i.exposed is free and open source. If it helped you, consider a tip." })}
        </span>
        <ChevronDown
          size={14}
          className={`text-muted shrink-0 transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
        />
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
    </motion.div>
  );
}
