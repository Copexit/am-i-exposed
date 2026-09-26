"use client";

import { useTranslation } from "react-i18next";
import { FindingCard } from "./FindingCard";
import { CollapsibleSection } from "./ui/Collapse";
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
  return (
    <CollapsibleSection label={label} delay={delay} defaultOpen={defaultOpen}>
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
    </CollapsibleSection>
  );
}
