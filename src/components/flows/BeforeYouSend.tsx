"use client";

import { useTranslation } from "react-i18next";
import { FileSignature, TriangleAlert } from "lucide-react";
import { formatSats } from "@/lib/format";
import type { LocalTx } from "@/lib/input/local-tx";
import type { MempoolTransaction } from "@/lib/api/types";
import type { ScoringResult } from "@/lib/types";

interface BeforeYouSendProps {
  local: LocalTx;
  /** Analyzed tx (prevouts patched after a lookup); falls back to the parsed one. */
  txData: MempoolTransaction | null;
  result: ScoringResult;
}

/** Context strip for a PSBT / raw tx analyzed in memory, before it is broadcast. */
export function BeforeYouSend({ local, txData }: BeforeYouSendProps) {
  const { t, i18n } = useTranslation();
  const tx = txData ?? local.tx;
  const known = tx.vin.every((v) => v.prevout);
  const fee = known ? tx.fee : 0;
  const vsize = Math.ceil(tx.weight / 4);
  const na = t("flows.notAvailable", { defaultValue: "N/A" });
  const facts = [
    { label: t("psbt.inputs", { defaultValue: "Inputs" }), value: String(tx.vin.length) },
    { label: t("psbt.outputs", { defaultValue: "Outputs" }), value: String(tx.vout.length) },
    { label: t("psbt.fee", { defaultValue: "Fee" }), value: fee > 0 ? formatSats(fee, i18n.language) : na },
    { label: t("psbt.feeRate", { defaultValue: "Fee rate" }), value: fee > 0 && vsize > 0 ? `${Math.round(fee / vsize)} sat/vB` : na },
  ];
  const title = t("local.title", { defaultValue: "Before you send" });

  return (
    <section
      data-testid="before-you-send"
      aria-label={title}
      className="w-full rounded-xl border border-bitcoin/25 bg-bitcoin/[0.04] px-4 sm:px-5 py-4 space-y-3"
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-2 text-sm font-medium text-bitcoin">
          <FileSignature size={16} aria-hidden="true" />
          {title}
        </span>
        <span className="text-[13px] text-muted">
          {t("flows.psbtLocal", { defaultValue: "Analyzed locally. Nothing is sent unless you choose to." })}
        </span>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
        {facts.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-[13px] text-muted">{f.label}</dt>
            <dd className="num text-[15px] text-foreground mt-0.5 break-words">{f.value}</dd>
          </div>
        ))}
      </dl>
      {!known && (
        <p className="flex items-start gap-2 text-[13px] text-severity-medium">
          <TriangleAlert size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
          {t("psbt.incomplete", { defaultValue: "Some inputs are missing UTXO data. Fee calculation may be incomplete." })}
        </p>
      )}
    </section>
  );
}
