"use client";

import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePrivacyNotice } from "@/components/PrivacyNotice";

/** Slim, dismissible clearnet notice under the v2 header (same logic as classic PrivacyNotice). */
export function V2PrivacyNotice() {
  const { t } = useTranslation();
  const { visible, dismiss } = usePrivacyNotice();

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          key="privacy-notice"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="overflow-hidden border-t border-hairline"
        >
          <div className="mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-8 flex items-center gap-2.5 min-h-9">
            <span className="size-1.5 shrink-0 rounded-full bg-severity-medium" aria-hidden="true" />
            <p className="flex-1 py-2 text-[13px] leading-snug text-muted">
              {t("common.privacyNotice", { defaultValue: "Queries are sent to mempool.space - your IP is visible. Use Tor or a VPN for stronger privacy." })}
            </p>
            <button
              type="button"
              onClick={dismiss}
              aria-label={t("common.dismiss", { defaultValue: "Dismiss" })}
              className="-mr-2 inline-flex size-11 sm:size-8 shrink-0 items-center justify-center rounded-lg text-faint hover:text-foreground transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-bitcoin"
            >
              <X size={14} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
