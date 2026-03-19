"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { FindingCard } from "./FindingCard";
import { CHAIN_FINDING_IDS } from "./ChainAnalysisPanel";
import type { Finding } from "@/lib/types";

interface FindingsTierProps {
  findings: Finding[];
  label: string;
  defaultOpen: boolean;
  delay: number;
  /** Callback when user clicks a txid link inside a finding card. */
  onTxClick?: (txid: string) => void;
  /** Pro mode: show confidence badges and score impact on finding cards. */
  proMode?: boolean;
}

export function FindingsTier({ findings, label, defaultOpen, delay, onTxClick, proMode = false }: FindingsTierProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className="w-full"
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-1 py-2 text-left group cursor-pointer"
        aria-expanded={open}
      >
        <ChevronRight
          size={14}
          className={`text-muted transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        />
        <span className="text-sm font-medium text-muted uppercase tracking-wider">
          {label}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="space-y-3 pt-1">
              {findings.map((finding, i) => (
                <FindingCard
                  key={finding.id}
                  finding={finding}
                  index={i}
                  defaultExpanded={false}
                  badge={CHAIN_FINDING_IDS.has(finding.id) ? t("results.chainBadge", { defaultValue: "Chain" }) : undefined}
                  onTxClick={onTxClick}
                  proMode={proMode}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
