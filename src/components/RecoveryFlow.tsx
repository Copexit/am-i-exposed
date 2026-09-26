"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import { Collapse } from "./ui/Collapse";
import { RecoveryStepList, RecoveryToolLinks } from "./guide/RecoveryPlaybook";

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
      <Collapse open={open}>
        <div id="recovery-flow-panel" className="mt-2 space-y-1">
          <p className="text-sm text-muted px-1 mb-3">
            {t("recoveryFlow.intro", {
              defaultValue: "Follow these steps to improve your privacy score from Critical/F to Healthy/A:",
            })}
          </p>

          <RecoveryStepList size="sm" />

          {/* Result indicator */}
          <div className="flex justify-center pt-2">
            <div className="bg-severity-good/10 border border-severity-good/30 rounded-lg px-4 py-2 text-sm text-severity-good font-medium">
              {t("recoveryFlow.result", { defaultValue: "Result: Critical -> Moderate -> Healthy" })}
            </div>
          </div>

          <RecoveryToolLinks />
        </div>
      </Collapse>
    </div>
  );
}
