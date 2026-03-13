"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ArrowDown, ExternalLink } from "lucide-react";
import { WalletIcon } from "@/components/ui/WalletIcon";
import { RECOVERY_STEPS, RECOVERY_TOOLS } from "@/data/guide/recovery";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "border-severity-critical/40 bg-severity-critical/5",
  high: "border-severity-high/40 bg-severity-high/5",
  medium: "border-severity-medium/40 bg-severity-medium/5",
  good: "border-severity-good/40 bg-severity-good/5",
};

const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-severity-critical",
  high: "bg-severity-high",
  medium: "bg-severity-medium",
  good: "bg-severity-good",
};

interface RecoveryFlowProps {
  /** Only show for poor grades */
  grade: string;
}

export function RecoveryFlow({ grade }: RecoveryFlowProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  // Only render for poor grades
  if (grade !== "D" && grade !== "F") return null;

  return (
    <div className="w-full">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="recovery-flow-panel"
        className="inline-flex items-center gap-1.5 text-sm text-severity-critical/80 hover:text-severity-critical transition-colors cursor-pointer bg-severity-critical/10 rounded-lg px-3 py-3"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
        {t("recoveryFlow.title", { defaultValue: "How to recover from a bad score" })}
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
            <div id="recovery-flow-panel" className="mt-2 space-y-1">
              <p className="text-sm text-muted px-1 mb-3">
                {t("recoveryFlow.intro", {
                  defaultValue: "Follow these steps to improve your privacy score from Critical/F to Healthy/A:",
                })}
              </p>

              {RECOVERY_STEPS.map((step, i) => (
                <div key={i}>
                  <div className={`rounded-lg border px-4 py-3 ${SEVERITY_COLORS[step.severity]}`}>
                    <div className="flex items-start gap-3">
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${SEVERITY_DOT[step.severity]}`}>
                          {i + 1}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground/90">
                          {t(step.titleKey, { defaultValue: step.titleDefault })}
                        </p>
                        <p className="text-sm text-muted mt-1 leading-relaxed">
                          {t(step.descKey, { defaultValue: step.descDefault })}
                        </p>
                      </div>
                    </div>
                  </div>
                  {i < RECOVERY_STEPS.length - 1 && (
                    <div className="flex justify-center py-0.5">
                      <ArrowDown size={14} className="text-muted/50" />
                    </div>
                  )}
                </div>
              ))}

              {/* Result indicator */}
              <div className="flex justify-center pt-2">
                <div className="bg-severity-good/10 border border-severity-good/30 rounded-lg px-4 py-2 text-sm text-severity-good font-medium">
                  {t("recoveryFlow.result", { defaultValue: "Result: Critical -> Moderate -> Healthy" })}
                </div>
              </div>

              {/* Tools */}
              <div className="flex flex-wrap gap-2 pt-2">
                {RECOVERY_TOOLS.map((tool) => (
                  <a
                    key={tool.name}
                    href={tool.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-bitcoin hover:text-bitcoin-hover transition-colors px-3 py-1.5 rounded-lg border border-bitcoin/20 hover:border-bitcoin/40 bg-bitcoin/5"
                  >
                    <WalletIcon walletName={tool.name} size="sm" />
                    {tool.name}
                    <ExternalLink size={12} />
                  </a>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
