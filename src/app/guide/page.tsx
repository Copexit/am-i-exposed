"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PageShell } from "@/components/PageShell";
import { PATHWAYS, COMBINED_PATHWAYS } from "@/data/guide/pathways";
import { PrivacyTechniques } from "@/components/guide/PrivacyTechniques";
import { CombinedStrategies } from "@/components/guide/CombinedStrategies";
import { WalletComparison } from "@/components/guide/WalletComparison";
import { GuideMistakes } from "@/components/guide/GuideMistakes";
import { RecoveryPlaybook } from "@/components/guide/RecoveryPlaybook";
import { MaintenanceSection } from "@/components/guide/MaintenanceSection";

export default function GuidePage() {
  const { t } = useTranslation();
  const [expandedPathway, setExpandedPathway] = useState<string | null>(null);
  const [showCombined, setShowCombined] = useState(false);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;

    const timer = setTimeout(() => {
      const matched = PATHWAYS.find((p) => p.id === hash);
      if (matched) setExpandedPathway(matched.id);

      if (COMBINED_PATHWAYS.some((c) => c.id === hash)) setShowCombined(true);

      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
    return () => clearTimeout(timer);
  }, []);

  return (
    <PageShell backLabel={t("guide.back", { defaultValue: "Back to scanner" })}>
        {/* Title */}
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-3">
            {t("guide.title", { defaultValue: "Bitcoin Privacy Guide" })}
          </h1>
          <p className="text-muted text-lg leading-relaxed max-w-2xl">
            {t("guide.subtitle", { defaultValue: "Techniques, tools, and best practices for maintaining Bitcoin privacy. All the educational content from am-i.exposed in one reference." })}
          </p>
        </div>

        {/* TOC */}
        <nav className="bg-surface-inset rounded-lg px-5 py-4 space-y-1.5" aria-label="Table of contents">
          <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">
            {t("guide.tocTitle", { defaultValue: "Sections" })}
          </p>
          {[
            { id: "privacy-techniques", label: t("guide.toc.techniques", { defaultValue: "Privacy techniques" }) },
            { id: "combined-strategies", label: t("guide.toc.combined", { defaultValue: "Combined strategies" }) },
            { id: "wallet-comparison", label: t("guide.toc.wallets", { defaultValue: "Wallet comparison" }) },
            { id: "common-mistakes", label: t("guide.toc.mistakes", { defaultValue: "Common mistakes" }) },
            { id: "recovery-playbook", label: t("guide.toc.recovery", { defaultValue: "Recovery playbook" }) },
            { id: "maintaining-privacy", label: t("guide.toc.maintaining", { defaultValue: "Maintaining privacy" }) },
          ].map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="block text-base text-bitcoin/80 hover:text-bitcoin transition-colors"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <PrivacyTechniques
          expandedPathway={expandedPathway}
          onTogglePathway={(id) => setExpandedPathway(expandedPathway === id ? null : id)}
        />

        <CombinedStrategies
          expanded={showCombined}
          onToggle={() => setShowCombined(!showCombined)}
        />

        <WalletComparison />

        <GuideMistakes />

        <RecoveryPlaybook />

        <MaintenanceSection />

        {/* Back to top */}
        <div className="text-center pt-6 pb-4">
          <a
            href="#"
            className="text-sm text-muted hover:text-foreground transition-colors"
          >
            {t("guide.backToTop", { defaultValue: "Back to top" })} &uarr;
          </a>
        </div>
    </PageShell>
  );
}
