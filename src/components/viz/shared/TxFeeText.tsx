"use client";

import { useTranslation } from "react-i18next";
import { formatSats, calcFeeRate } from "@/lib/format";
import type { MempoolTransaction } from "@/lib/api/types";

/** "Fee: N sats (R sat/vB)" line under the tx diagrams. */
export function TxFeeText({ tx }: { tx: MempoolTransaction }) {
  const { t, i18n } = useTranslation();
  const amount = formatSats(tx.fee, i18n.language);
  const rate = calcFeeRate(tx);
  return <span>{t("tx.fee", { amount, rate, defaultValue: `Fee: ${amount} (${rate} sat/vB)` })}</span>;
}
