"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeftRight, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NETWORK_CONFIG, type BitcoinNetwork } from "@/lib/bitcoin/networks";

/** Transient notice shown when a txid lookup auto-switched networks. */
export function NetworkSwitchToast({ network }: { network: BitcoinNetwork }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.3 }}
          className="fixed top-4 left-4 right-4 max-w-sm mx-auto z-50 flex items-center gap-3 rounded-xl border border-bitcoin/30 px-4 py-3 text-sm text-foreground"
          style={{ background: "var(--card-bg)", boxShadow: "var(--glass-shadow)" }}
        >
          <ArrowLeftRight size={16} className="text-bitcoin shrink-0" aria-hidden="true" />
          <span className="flex-1">
            {t("page.networkAutoSwitched", {
              network: NETWORK_CONFIG[network].label,
              defaultValue: "Switched to {{network}} to find this transaction.",
            })}
          </span>
          <button
            onClick={() => setVisible(false)}
            aria-label={t("common.dismiss", { defaultValue: "Dismiss" })}
            className="text-muted hover:text-foreground transition-colors cursor-pointer"
          >
            <X size={14} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
