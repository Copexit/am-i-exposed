"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { ChevronDown, XCircle } from "lucide-react";
import type { Finding } from "@/lib/types";

interface MistakeEntry {
  titleKey: string;
  titleDefault: string;
  descKey: string;
  descDefault: string;
  /** Only show when a specific finding ID is present */
  triggerFinding?: string;
}

const MISTAKES: MistakeEntry[] = [
  {
    titleKey: "mistakes.coinjoinConsolidate",
    titleDefault: "CoinJoin then consolidate all outputs",
    descKey: "mistakes.coinjoinConsolidateDesc",
    descDefault: "Combining CoinJoin outputs in a single transaction re-links them via common input ownership heuristic (CIOH), undoing the entire mix.",
  },
  {
    titleKey: "mistakes.exchangeDirect",
    titleDefault: "Send directly from exchange to final destination",
    descKey: "mistakes.exchangeDirectDesc",
    descDefault: "Exchange withdrawal addresses are in chain analysis databases. Sending directly to your destination links the receiver to your exchange account.",
  },
  {
    titleKey: "mistakes.wasabiThenSend",
    titleDefault: "Mix with Wasabi then send immediately",
    descKey: "mistakes.wasabiThenSendDesc",
    descDefault: "Wasabi's nVersion=1 fingerprint identifies the pre-CoinJoin transaction. Spending immediately after creates a timing correlation. Wait several blocks and use a different wallet for the spend.",
  },
  {
    titleKey: "mistakes.reuseAddress",
    titleDefault: "Change wallet but reuse the receiver's address",
    descKey: "mistakes.reuseAddressDesc",
    descDefault: "Switching wallets improves fingerprinting, but if you reuse the same receiving address, all prior transaction history is still linked.",
    triggerFinding: "h8-address-reuse",
  },
  {
    titleKey: "mistakes.torOnly",
    titleDefault: "Use Tor only without changing on-chain behavior",
    descKey: "mistakes.torOnlyDesc",
    descDefault: "Tor protects your IP address, not your blockchain footprint. If your transactions still have round amounts, address reuse, and identifiable fingerprints, Tor alone does not help.",
  },
];

interface CommonMistakesProps {
  findings: Finding[];
  grade: string;
}

export function CommonMistakes({ findings, grade }: CommonMistakesProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  // Only show for poor grades
  if (grade !== "C" && grade !== "D" && grade !== "F") return null;

  const ids = new Set(findings.map((f) => f.id));
  const visibleMistakes = MISTAKES.filter(
    (m) => !m.triggerFinding || ids.has(m.triggerFinding),
  );

  if (visibleMistakes.length === 0) return null;

  return (
    <div className="w-full">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="common-mistakes-panel"
        className="inline-flex items-center gap-1.5 text-sm text-severity-high/80 hover:text-severity-high transition-colors cursor-pointer bg-severity-high/10 rounded-lg px-3 py-3"
      >
        <XCircle size={16} aria-hidden="true" />
        {t("mistakes.title", { defaultValue: "Common mistakes to avoid" })}
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
            <div id="common-mistakes-panel" className="mt-2 space-y-2">
              {visibleMistakes.map((mistake, i) => (
                <div
                  key={i}
                  className="bg-severity-high/5 border border-severity-high/15 rounded-lg px-4 py-3"
                >
                  <div className="flex items-start gap-2">
                    <XCircle size={14} className="text-severity-high shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-foreground/90">
                        {t(mistake.titleKey, { defaultValue: mistake.titleDefault })}
                      </p>
                      <p className="text-sm text-muted mt-1 leading-relaxed">
                        {t(mistake.descKey, { defaultValue: mistake.descDefault })}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
