"use client";

import { memo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import type { Finding } from "@/lib/types";
import { findingKeys } from "@/lib/finding-utils";
import { FindingCardBody } from "@/components/FindingCard";
import { CHAIN_FINDING_IDS } from "@/components/ChainAnalysisPanel";
import { WalletIcon } from "@/components/ui/WalletIcon";
import { Collapse } from "@/components/ui/Collapse";
import { SEVERITY_BG, SEVERITY_TEXT } from "./severity";

const TEMPORALITY_LABEL = {
  historical: { key: "temporality.historical", def: "Past" },
  ongoing_pattern: { key: "temporality.ongoing_pattern", def: "Pattern" },
  active_risk: { key: "temporality.active_risk", def: "Active" },
} as const;

interface FindingItemProps {
  finding: Finding;
  open: boolean;
  onToggle: (id: string) => void;
  highlighted: boolean;
  dimmed: boolean;
  onHover?: (id: string | null) => void;
  onTxClick?: (txid: string) => void;
}

/** One finding: a calm row that expands into the full shared detail body. */
export const FindingItem = memo(function FindingItem({ finding, open, onToggle, highlighted, dimmed, onHover, onTxClick }: FindingItemProps) {
  const { t } = useTranslation();
  const title = t(findingKeys(finding.id, "title", finding.params), { ...finding.params, defaultValue: finding.title });
  const severityLabel = t(`common.severity.${finding.severity}`, { defaultValue: finding.severity });
  const temp = finding.temporality ? TEMPORALITY_LABEL[finding.temporality] : null;
  const impact = finding.scoreImpact;

  return (
    <article
      data-finding-id={finding.id}
      aria-label={t("finding.ariaLabel", { severity: severityLabel, title, defaultValue: "{{severity}} finding: {{title}}" })}
      onMouseEnter={() => onHover?.(finding.id)}
      onMouseLeave={() => onHover?.(null)}
      className={`relative border-b border-hairline last:border-b-0 transition-[opacity,background-color] duration-200 ${highlighted ? "bg-surface-2" : ""} ${dimmed ? "opacity-45" : ""}`}
    >
      <span className={`absolute left-0 top-3 bottom-3 w-[2px] rounded-full ${SEVERITY_BG[finding.severity]}`} aria-hidden="true" />
      <button
        type="button"
        onClick={() => onToggle(finding.id)}
        aria-expanded={open}
        aria-controls={`finding-detail-${finding.id}`}
        className="w-full grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 pl-5 pr-3 py-3.5 min-h-[52px] text-left hover:bg-surface-2/60 transition-colors rounded-md"
      >
        <span className="flex items-center gap-2.5 min-w-0">
          {finding.id === "h11-wallet-fingerprint" && finding.params?.walletGuess && (
            <WalletIcon walletName={String(finding.params.walletGuess)} size="sm" />
          )}
          <span className="text-[15px] font-medium leading-snug text-foreground">{title}</span>
        </span>
        <span className="flex items-center gap-3 justify-self-end">
          {CHAIN_FINDING_IDS.has(finding.id) && (
            <span className="hidden sm:inline text-[11px] text-faint">{t("results.chainBadge", { defaultValue: "Chain" })}</span>
          )}
          {temp && finding.severity !== "good" && (
            <span className="hidden sm:inline text-[11px] text-faint">{t(temp.key, { defaultValue: temp.def })}</span>
          )}
          <span className={`text-xs ${SEVERITY_TEXT[finding.severity]}`}>{severityLabel}</span>
          <span className={`v2-num text-sm w-9 text-right ${impact > 0 ? "text-severity-good" : impact < 0 ? "text-foreground" : "text-faint"}`}>
            {impact > 0 ? `+${impact}` : impact === 0 ? "0" : impact}
          </span>
          <ChevronDown size={15} className={`text-faint transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </span>
      </button>
      <Collapse open={open}>
        <FindingCardBody finding={finding} onTxClick={onTxClick} proMode variant="v2" className="pl-5 pr-3 pb-5 pt-1 space-y-3" />
      </Collapse>
    </article>
  );
});
