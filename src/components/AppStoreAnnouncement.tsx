"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import Link from "next/link";
import { Server, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { UMBREL_APP_URL, STARTOS_SETUP_ANCHOR } from "@/lib/external-links";

export const APPSTORE_ANNOUNCE_DISMISS_KEY = "ami-appstore-announcement-dismissed";

/**
 * Clearnet-only announcement that am-i.exposed is now in the official Umbrel and
 * StartOS app stores. Hidden for visitors already on a self-hosted backend
 * (isUmbrel). Dismissal is permanent - a localStorage boolean, once closed it
 * never shows again. InstallPrompt yields to this banner until it is dismissed,
 * so only one bottom banner is ever visible at a time.
 */
export function AppStoreAnnouncement() {
  const { t } = useTranslation();
  const { isUmbrel } = useNetwork();
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Defer the localStorage read out of the synchronous effect body (matches
    // InstallPrompt and avoids a same-tick setState).
    const timer = setTimeout(() => {
      try {
        setDismissed(localStorage.getItem(APPSTORE_ANNOUNCE_DISMISS_KEY) === "1");
      } catch { /* localStorage unavailable (private browsing) */ }
      setReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(APPSTORE_ANNOUNCE_DISMISS_KEY, "1"); } catch { /* private browsing */ }
  };

  // Render nothing until the dismiss flag is read (avoids SSR/hydration flash),
  // for self-hosted visitors, or once permanently dismissed.
  if (!ready || isUmbrel || dismissed) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="fixed bottom-4 left-4 right-4 max-w-sm mx-auto rounded-xl overflow-hidden border border-glass-border p-4 z-50"
        style={{ background: "var(--card-bg)", boxShadow: "var(--glass-shadow)" }}
        role="region"
        aria-label={t("appstore.announce_title", { defaultValue: "Run am-i.exposed on your own node" })}
      >
        <div className="flex items-start gap-3">
          <Server size={18} className="text-bitcoin shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 space-y-2">
            <p className="text-sm font-medium text-foreground">
              {t("appstore.announce_title", { defaultValue: "Run am-i.exposed on your own node" })}
            </p>
            <p className="text-sm text-muted">
              {t("appstore.announce_desc", { defaultValue: "Now in the official Umbrel & StartOS app stores - 100% local and private." })}
            </p>
            <div className="flex flex-wrap gap-2 pt-0.5">
              <a
                href={UMBREL_APP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-bitcoin bg-bitcoin/10 hover:bg-bitcoin/20 px-3 py-2.5 rounded-lg transition-colors"
              >
                {t("appstore.cta_umbrel", { defaultValue: "Umbrel" })}
              </a>
              <Link
                href={STARTOS_SETUP_ANCHOR}
                className="text-xs font-medium text-bitcoin bg-bitcoin/10 hover:bg-bitcoin/20 px-3 py-2.5 rounded-lg transition-colors"
              >
                {t("appstore.cta_startos", { defaultValue: "StartOS" })}
              </Link>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="text-muted hover:text-foreground transition-colors shrink-0 cursor-pointer p-2"
            aria-label={t("common.dismiss", { defaultValue: "Dismiss" })}
          >
            <X size={14} />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
