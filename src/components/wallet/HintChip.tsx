"use client";

import { useTranslation } from "react-i18next";
import type { OriginHint } from "@/lib/analysis/coin-selection";
import type { CoinClass } from "@/lib/analysis/wallet-behavior";

/** Fee rate at which a coin is flagged as worth no more than its own input fee. */
export const REFERENCE_FEE_RATE = 20;

/** `class`: the coin's origin class when it is not a CoinJoin output (those have their own chips). */
export type Hint =
  | OriginHint
  | { kind: "dust" }
  | { kind: "uneconomical" }
  | { kind: "class"; origin: CoinClass }
  /** Linkage group of 2+ coins in the UTXO list; `inferred` when only probably linked */
  | { kind: "group"; letter: string; inferred: boolean };

/** Origin hint chip shared by the coin selection advisor and the UTXO list. */
export function HintChip({ hint }: { hint: Hint }) {
  const { t } = useTranslation();
  // Probable (inferred) links are dashed, certain ones solid.
  const dashed = hint.kind === "probably-linked" || (hint.kind === "group" && hint.inferred);
  const tone =
    hint.kind === "coinjoin" ? "text-severity-good border-severity-good/30"
    : hint.kind === "coinjoin-change" || hint.kind === "reused-address" ? "text-severity-high border-severity-high/30"
    : hint.kind === "dust" || hint.kind === "uneconomical" ? "text-severity-medium border-severity-medium/30"
    : "text-muted border-hairline-strong";
  // CoinJoin chips use the coin-origins labels, so the list, the bar and the advisor agree.
  const label =
    hint.kind === "coinjoin" ? t("wallet.origin.mixed", { defaultValue: "Mixed (CoinJoin)" })
    : hint.kind === "coinjoin-change" ? t("wallet.origin.coinjoin-change", { defaultValue: "CoinJoin change" })
    : hint.kind === "class" ? t(`wallet.origin.${hint.origin}`)
    : hint.kind === "group" ? t(hint.inferred ? "wallet.utxos.groupInferred" : "wallet.utxos.group", { letter: hint.letter })
    : hint.kind === "dust" ? t("wallet.utxos.hint.dust", { defaultValue: "Dust" })
    : hint.kind === "uneconomical" ? t("wallet.utxos.hint.uneconomical", { rate: REFERENCE_FEE_RATE, defaultValue: "Uneconomical at {{rate}} sat/vB" })
    : t(`wallet.coinSel.hint.${hint.kind}`, { n: "with" in hint ? hint.with : 0 });
  const title =
    hint.kind === "group" ? t(hint.inferred ? "wallet.utxos.groupInferredTitle" : "wallet.utxos.groupTitle")
    : hint.kind === "probably-linked" ? t("wallet.coinSel.note.probablyLinked")
    : undefined;
  return <span title={title} className={`text-[11px] leading-none whitespace-nowrap border rounded px-1.5 py-1 ${dashed ? "border-dashed" : ""} ${tone}`}>{label}</span>;
}
