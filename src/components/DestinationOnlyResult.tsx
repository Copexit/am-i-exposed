"use client";

import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import { GlowCard } from "@/components/ui/GlowCard";
import { FindingCard } from "@/components/FindingCard";
import { RISK_CONFIG } from "@/components/DestinationAlert";
import { ACTION_BTN_CLASS } from "@/lib/constants";
import type { PreSendResult } from "@/lib/analysis/orchestrator";

interface DestinationOnlyResultProps {
  query: string;
  preSendResult: PreSendResult;
  onBack: () => void;
  durationMs?: number | null;
}

export function DestinationOnlyResult({ query, preSendResult, onBack, durationMs }: DestinationOnlyResultProps) {
  const { t } = useTranslation();
  const risk = RISK_CONFIG[preSendResult.riskLevel];
  const RiskIcon = risk.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className="flex flex-col items-center gap-8 w-full max-w-3xl"
    >
      <div className="w-full flex items-center">
        <button
          onClick={onBack}
          className={ACTION_BTN_CLASS}
        >
          <ArrowLeft size={16} />
          {t("results.newScan", { defaultValue: "New scan" })}
        </button>
      </div>

      <GlowCard className="w-full p-7 space-y-6">
        <div className="space-y-1">
          <span className="text-sm font-medium text-muted uppercase tracking-wider">
            {t("results.address", { defaultValue: "Address" })}
          </span>
          <p className="font-mono text-sm text-foreground/90 break-all leading-relaxed">{query}</p>
        </div>
        <div className={`rounded-xl border p-6 ${risk.bg} flex flex-col items-center gap-3`}>
          <RiskIcon size={40} className={risk.color} />
          <span className={`text-2xl font-bold ${risk.color}`}>
            {t(risk.labelKey, { defaultValue: risk.labelDefault })}
          </span>
          <p className="text-sm text-center text-foreground max-w-md">
            {t(preSendResult.summaryKey, {
              reuseCount: preSendResult.timesReceived,
              txCount: preSendResult.txCount,
              defaultValue: preSendResult.summary,
            })}
          </p>
        </div>
      </GlowCard>

      {preSendResult.findings.length > 0 && (
        <div className="w-full space-y-3">
          <h2 className="text-base font-medium text-muted uppercase tracking-wider px-1">
            {t("results.findingsHeading", { count: preSendResult.findings.length, defaultValue: "Findings ({{count}})" })}
          </h2>
          <div className="space-y-2">
            {preSendResult.findings.map((finding, i) => (
              <FindingCard key={finding.id} finding={finding} index={i} />
            ))}
          </div>
        </div>
      )}

      <div className="w-full bg-surface-inset rounded-lg px-4 py-3 text-sm text-muted leading-relaxed">
        {t("presend.disclaimerCompleted", { defaultValue: "Pre-send check completed" })}{durationMs ? t("presend.disclaimerDuration", { duration: (durationMs / 1000).toFixed(1), defaultValue: " in {{duration}}s" }) : ""}.
        {" "}{t("presend.disclaimerBrowser", { defaultValue: "Analysis ran entirely in your browser. This is a heuristic-based assessment - always verify independently." })}
      </div>
    </motion.div>
  );
}
