"use client";

import { useTranslation } from "react-i18next";
import type { OriginHint } from "@/lib/analysis/coin-selection";

/** Fee rate at which a coin is flagged as worth no more than its own input fee. */
export const REFERENCE_FEE_RATE = 20;

export type Hint = OriginHint | { kind: "dust" } | { kind: "uneconomical" };

/** Origin hint chip shared by the coin selection advisor and the UTXO list. */
export function HintChip({ hint }: { hint: Hint }) {
  const { t } = useTranslation();
  const tone =
    hint.kind === "coinjoin" ? "text-severity-good border-severity-good/30"
    : hint.kind === "reused-address" ? "text-severity-high border-severity-high/30"
    : hint.kind === "dust" || hint.kind === "uneconomical" ? "text-severity-medium border-severity-medium/30"
    : "text-muted border-hairline-strong";
  const label =
    hint.kind === "dust" ? t("wallet.utxos.hint.dust", { defaultValue: "Dust" })
    : hint.kind === "uneconomical" ? t("wallet.utxos.hint.uneconomical", { rate: REFERENCE_FEE_RATE, defaultValue: "Uneconomical at {{rate}} sat/vB" })
    : t(`wallet.coinSel.hint.${hint.kind}`, { n: "with" in hint ? hint.with : 0 });
  return <span className={`text-[11px] leading-none whitespace-nowrap border rounded px-1.5 py-1 ${tone}`}>{label}</span>;
}
