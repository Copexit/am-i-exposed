"use client";

import { createContext, useContext } from "react";
import { useTranslation } from "react-i18next";
import type { LabelTag, WalletLabels } from "@/lib/wallet/labels";

/** Wallet labels matched to the scanned wallet, or null when none are loaded. */
export const WalletLabelsContext = createContext<WalletLabels | null>(null);
export const useWalletLabels = () => useContext(WalletLabelsContext);

const TAG_TONE: Record<LabelTag, string> = {
  kyc: "text-severity-high border-severity-high/30",
  nokyc: "text-severity-low border-severity-low/30",
  cj: "text-severity-good border-severity-good/30",
  change: "text-muted border-hairline-strong",
  toxic: "text-severity-critical border-severity-critical/30",
  person: "text-severity-medium border-severity-medium/30",
};

const TAG_DEFAULT: Record<LabelTag, string> = {
  kyc: "KYC", nokyc: "no-KYC", cj: "CoinJoin", change: "Change", toxic: "Toxic", person: "Person",
};

/** Origin class from a label prefix. Dashed when inherited from the coins that funded it. */
export function LabelTagChip({ tag, inherited = false }: { tag: LabelTag; inherited?: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      data-testid={`label-tag-${tag}`}
      title={inherited ? t("wallet.labels.inheritedTitle", { defaultValue: "Inherited from the coins that funded it (change keeps its parent's origin)" }) : undefined}
      className={`text-[11px] leading-none whitespace-nowrap border rounded px-1.5 py-1 font-medium ${inherited ? "border-dashed" : ""} ${TAG_TONE[tag]}`}
    >
      {t(`wallet.labels.tag.${tag}`, { defaultValue: TAG_DEFAULT[tag] })}
    </span>
  );
}

/** A label's text, one line, truncated with the full text on hover. */
export function LabelText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span data-testid="label-text" title={text} className={`text-[12px] leading-5 text-foreground/80 truncate min-w-0 ${className}`}>
      {text}
    </span>
  );
}
