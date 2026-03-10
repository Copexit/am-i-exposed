"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ShieldCheck } from "lucide-react";
import type { Finding } from "@/lib/types";

interface MaintenanceSection {
  titleKey: string;
  titleDefault: string;
  tipsKeys: { key: string; default: string }[];
}

const SECTIONS: MaintenanceSection[] = [
  {
    titleKey: "maintenance.utxoHygiene",
    titleDefault: "UTXO hygiene",
    tipsKeys: [
      { key: "maintenance.utxoHygiene1", default: "Label every UTXO by source (exchange, P2P, CoinJoin, mining, payment). Never merge UTXOs from different sources." },
      { key: "maintenance.utxoHygiene2", default: "Segregate KYC-sourced UTXOs from non-KYC. Treat them as separate wallets with separate spending strategies." },
      { key: "maintenance.utxoHygiene3", default: "Freeze dust outputs (under 1,000 sats). Spending them costs more in fees than they are worth and can link your addresses." },
      { key: "maintenance.utxoHygiene4", default: "If consolidation is necessary within a privacy category, time it during low-fee periods (under 5-10 sat/vB, often weekend nights UTC). Ensure resulting UTXOs are at least 1,000,000 sats to remain economically viable during fee spikes." },
      { key: "maintenance.utxoHygiene5", default: "Label every UTXO by source (e.g., 'KYC-exchange', 'P2P-cash', 'CoinJoin-mixed'). Use BIP329 label export when migrating wallets. Labels prevent accidental cross-contamination of privacy contexts." },
    ],
  },
  {
    titleKey: "maintenance.postSpend",
    titleDefault: "Post-spend discipline",
    tipsKeys: [
      { key: "maintenance.postSpend1", default: "Spend one UTXO per transaction whenever possible. Multiple inputs link addresses via Common Input Ownership." },
      { key: "maintenance.postSpend2", default: "Never consolidate CoinJoin outputs. Each mixed output is an independent privacy unit - merging them undoes the mix." },
      { key: "maintenance.postSpend3", default: "After CoinJoin, wait at least a few blocks before spending. Immediate post-mix spending creates timing correlation." },
    ],
  },
  {
    titleKey: "maintenance.network",
    titleDefault: "Network privacy",
    tipsKeys: [
      { key: "maintenance.network1", default: "Connect your wallet through Tor to hide which addresses you query from the node operator." },
      { key: "maintenance.network2", default: "Run your own Bitcoin node and mempool instance. This eliminates all third-party address queries." },
      { key: "maintenance.network3", default: "Use a VPN or Tor when accessing block explorers in a web browser." },
    ],
  },
  {
    titleKey: "maintenance.wallet",
    titleDefault: "Wallet consistency",
    tipsKeys: [
      { key: "maintenance.wallet1", default: "Stick with one wallet family to avoid mixing fingerprints. Switching wallets mid-UTXO-lifetime creates detectable patterns." },
      { key: "maintenance.wallet2", default: "Ensure your wallet uses anti-fee-sniping (nLockTime = current block height) and standard nSequence values." },
    ],
  },
  {
    titleKey: "maintenance.spending",
    titleDefault: "Spending strategy",
    tipsKeys: [
      { key: "maintenance.spending1", default: "Use Branch-and-Bound (BnB) coin selection for changeless transactions when possible. Bitcoin Core uses BnB by default." },
      { key: "maintenance.spending2", default: "Match input and output script types (all P2WPKH or all P2TR). Mixed script types fingerprint the change output." },
      { key: "maintenance.spending3", default: "For privacy-critical payments, prefer CPFP over RBF for fee bumping - RBF reveals which output is change." },
      { key: "maintenance.spending4", default: "When making multiple payments, batch them into a single transaction. Multiple outputs increase ambiguity for change detection." },
      { key: "maintenance.spending5", default: "Use Sparrow's 'Spending Privately' feature to construct Stonewall-like transactions that mimic CoinJoin structure using only your own UTXOs." },
    ],
  },
];

interface MaintenanceGuideProps {
  grade: string;
  findings: Finding[];
}

export function MaintenanceGuide({ grade }: MaintenanceGuideProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  // Only show for good grades
  if (grade !== "A+" && grade !== "B") return null;

  return (
    <div className="w-full">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="maintenance-guide-panel"
        className="inline-flex items-center gap-1.5 text-sm text-severity-good/80 hover:text-severity-good transition-colors cursor-pointer bg-severity-good/10 rounded-lg px-3 py-3"
      >
        <ShieldCheck size={16} aria-hidden="true" />
        {t("maintenance.title", { defaultValue: "Maintaining your privacy" })}
        <ChevronDown
          size={16}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div id="maintenance-guide-panel" className="mt-2 space-y-3">
              <p className="text-sm text-muted leading-relaxed">
                {t("maintenance.intro", {
                  defaultValue:
                    "Good privacy is not a one-time achievement - it requires ongoing discipline. These practices help maintain the privacy gains detected in this analysis.",
                })}
              </p>
              {SECTIONS.map((section) => (
                <div
                  key={section.titleKey}
                  className="bg-severity-good/5 border border-severity-good/15 rounded-lg px-4 py-3"
                >
                  <p className="text-sm font-medium text-foreground/90 mb-1.5">
                    {t(section.titleKey, { defaultValue: section.titleDefault })}
                  </p>
                  <ul className="space-y-1">
                    {section.tipsKeys.map((tip) => (
                      <li key={tip.key} className="flex items-start gap-2 text-sm text-muted leading-relaxed">
                        <span className="text-severity-good shrink-0 mt-0.5">-</span>
                        {t(tip.key, { defaultValue: tip.default })}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
