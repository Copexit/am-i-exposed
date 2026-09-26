"use client";

import { useTranslation } from "react-i18next";
import { RISK_CONFIG } from "@/components/DestinationAlert";
import { CopyButton } from "@/components/ui/CopyButton";
import { fmtN } from "@/lib/format";
import type { PreSendResult } from "@/lib/analysis/orchestrator";
import { FlowShell, NewScanLink } from "./V2FlowUi";
import { V2FindingGroups } from "./V2FindingGroups";

interface V2DestinationProps {
  query: string;
  preSendResult: PreSendResult;
  onBack: () => void;
  durationMs?: number | null;
}

const RISK_BAR: Record<PreSendResult["riskLevel"], string> = {
  LOW: "bg-severity-good",
  MEDIUM: "bg-severity-medium",
  HIGH: "bg-severity-high",
  CRITICAL: "bg-severity-critical",
};

/** Pre-send destination check: risk verdict, facts, findings, disclaimer. */
export function V2Destination({ query, preSendResult, onBack, durationMs }: V2DestinationProps) {
  const { t } = useTranslation();
  const risk = RISK_CONFIG[preSendResult.riskLevel];
  const RiskIcon = risk.icon;

  const facts = [
    { label: t("v2.flows.transactions", { defaultValue: "Transactions" }), value: fmtN(preSendResult.txCount) },
    { label: t("v2.flows.timesReceived", { defaultValue: "Times received" }), value: fmtN(preSendResult.timesReceived) },
    { label: t("v2.flows.totalReceived", { defaultValue: "Total received" }), value: `${fmtN(preSendResult.totalReceived)} sats` },
  ];

  return (
    <FlowShell width="narrow" className="py-6 sm:py-10 space-y-8" testId="v2-destination">
      <NewScanLink onBack={onBack} />

      <section
        data-testid="v2-destination-verdict"
        data-risk={preSendResult.riskLevel}
        className="rounded-xl border border-hairline bg-surface-1 shadow-(--shadow-card) overflow-hidden"
      >
        <div className={`h-0.5 ${RISK_BAR[preSendResult.riskLevel]}`} aria-hidden="true" />
        <div className="p-5 sm:p-7 space-y-6">
          <div className="space-y-2 min-w-0">
            <span className="v2-eyebrow">{t("v2.flows.destinationCheck", { defaultValue: "Destination check" })}</span>
            <div className="flex items-start gap-2 min-w-0">
              <p className="v2-num text-[13px] text-foreground/90 break-all leading-relaxed">{query}</p>
              <CopyButton text={query} variant="inline" iconSize={14} className="shrink-0 p-2 -m-1" />
            </div>
          </div>

          <div className="flex items-start gap-4">
            <RiskIcon size={32} className={`${risk.color} shrink-0 mt-0.5`} aria-hidden="true" />
            <div className="space-y-2 min-w-0">
              <h1 className={`text-[28px] leading-tight font-semibold tracking-tight ${risk.color}`}>
                {t(risk.labelKey, { defaultValue: risk.labelDefault })}
              </h1>
              <p className="text-[15px] text-foreground/90 leading-relaxed max-w-[60ch]">
                {t(preSendResult.summaryKey, {
                  reuseCount: preSendResult.timesReceived,
                  txCount: preSendResult.txCount,
                  defaultValue: preSendResult.summary,
                })}
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 border-t border-hairline pt-5">
            {facts.map((f) => (
              <div key={f.label} className="min-w-0">
                <dt className="text-[13px] text-muted">{f.label}</dt>
                <dd className="v2-num text-lg mt-1 break-words">{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {preSendResult.findings.length > 0 && <V2FindingGroups findings={preSendResult.findings} />}

      <p className="text-[13px] text-muted leading-relaxed border-t border-hairline pt-5">
        {t("presend.disclaimerCompleted", { defaultValue: "Pre-send check completed" })}
        {durationMs ? t("presend.disclaimerDuration", { duration: (durationMs / 1000).toFixed(1), defaultValue: " in {{duration}}s" }) : ""}.
        {" "}{t("presend.disclaimerBrowser", { defaultValue: "Analysis ran entirely in your browser. This is a heuristic-based assessment - always verify independently." })}
      </p>
    </FlowShell>
  );
}
