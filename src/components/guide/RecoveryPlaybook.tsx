"use client";

import { CheckCircle2, ExternalLink, ArrowDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { WalletIcon } from "@/components/ui/WalletIcon";
import { RECOVERY_STEPS, RECOVERY_TOOLS } from "@/data/guide/recovery";
import { SEVERITY_COLORS, SEVERITY_DOT } from "@/lib/severity";

export function RecoveryPlaybook() {
  const { t } = useTranslation();

  return (
    <section className="space-y-4">
      <h2 id="recovery-playbook" className="text-2xl font-bold text-foreground scroll-mt-24">
        <CheckCircle2 size={20} className="inline mr-2 text-severity-critical" />
        {t("guide.recoveryTitle", { defaultValue: "Recovery playbook" })}
      </h2>
      <p className="text-base text-muted leading-relaxed">
        {t("recoveryFlow.intro", { defaultValue: "Follow these steps to improve your privacy score from Critical/F to Healthy/A:" })}
      </p>
      <div className="space-y-1">
        {RECOVERY_STEPS.map((step, i) => (
          <div key={i}>
            <div className={`rounded-lg border px-4 py-3 ${SEVERITY_COLORS[step.severity]}`}>
              <div className="flex items-start gap-3">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold text-white ${SEVERITY_DOT[step.severity]} shrink-0`}>
                  {i + 1}
                </span>
                <div>
                  <p className="text-base font-medium text-foreground/90">
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
      </div>
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
    </section>
  );
}
