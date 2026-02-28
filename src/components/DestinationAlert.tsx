"use client";

import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";
import type { PreSendResult } from "@/lib/analysis/orchestrator";

const RISK_CONFIG = {
  LOW: {
    icon: ShieldCheck,
    color: "text-severity-good",
    bg: "bg-severity-good/10 border-severity-good/30",
    labelKey: "presend.riskLow",
    labelDefault: "Low Risk",
  },
  MEDIUM: {
    icon: ShieldAlert,
    color: "text-severity-medium",
    bg: "bg-severity-medium/10 border-severity-medium/30",
    labelKey: "presend.riskMedium",
    labelDefault: "Medium Risk",
  },
  HIGH: {
    icon: ShieldAlert,
    color: "text-severity-high",
    bg: "bg-severity-high/10 border-severity-high/30",
    labelKey: "presend.riskHigh",
    labelDefault: "High Risk",
  },
  CRITICAL: {
    icon: ShieldX,
    color: "text-severity-critical",
    bg: "bg-severity-critical/10 border-severity-critical/30",
    labelKey: "presend.riskCritical",
    labelDefault: "Critical Risk",
  },
} as const;

interface DestinationAlertProps {
  preSendResult: PreSendResult;
}

export function DestinationAlert({ preSendResult }: DestinationAlertProps) {
  const { t } = useTranslation();
  const risk = RISK_CONFIG[preSendResult.riskLevel];
  const RiskIcon = risk.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className={`w-full rounded-xl border px-4 py-3 flex items-center gap-3 ${risk.bg}`}
    >
      <RiskIcon size={20} className={`${risk.color} shrink-0`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${risk.color}`}>
            {t("destination.sendRisk", { defaultValue: "Destination risk:" })}{" "}
            {t(risk.labelKey, { defaultValue: risk.labelDefault })}
          </span>
        </div>
        <p className="text-sm text-foreground/80 mt-0.5">
          {t(preSendResult.summaryKey, {
            reuseCount: preSendResult.timesReceived,
            txCount: preSendResult.txCount,
            defaultValue: preSendResult.summary,
          })}
        </p>
      </div>
    </motion.div>
  );
}
