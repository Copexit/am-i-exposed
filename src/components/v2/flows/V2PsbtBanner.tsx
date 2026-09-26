"use client";

import { useTranslation } from "react-i18next";
import { FileSignature, TriangleAlert } from "lucide-react";
import { formatSats } from "@/lib/format";

interface V2PsbtBannerProps {
  inputCount: number;
  outputCount: number;
  fee: number;
  feeRate: number;
  complete: boolean;
}

/** PSBT context strip for the results page: unsigned tx facts, analyzed locally. */
export function V2PsbtBanner({ inputCount, outputCount, fee, feeRate, complete }: V2PsbtBannerProps) {
  const { t, i18n } = useTranslation();
  const na = t("v2.flows.notAvailable", { defaultValue: "N/A" });
  const facts = [
    { label: t("psbt.inputs", { defaultValue: "Inputs" }), value: String(inputCount) },
    { label: t("psbt.outputs", { defaultValue: "Outputs" }), value: String(outputCount) },
    { label: t("psbt.fee", { defaultValue: "Fee" }), value: fee > 0 ? formatSats(fee, i18n.language) : na },
    { label: t("psbt.feeRate", { defaultValue: "Fee rate" }), value: feeRate > 0 ? `${feeRate} sat/vB` : na },
  ];

  return (
    <section
      data-testid="v2-psbt-banner"
      aria-label={t("psbt.banner", { defaultValue: "Pre-broadcast privacy analysis (PSBT)" })}
      className="w-full rounded-xl border border-bitcoin/25 bg-bitcoin/[0.04] px-4 sm:px-5 py-4 space-y-3"
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-2 text-sm font-medium text-bitcoin">
          <FileSignature size={16} aria-hidden="true" />
          {t("psbt.banner", { defaultValue: "Pre-broadcast privacy analysis (PSBT)" })}
        </span>
        <span className="text-[13px] text-muted">
          {t("v2.flows.psbtLocal", { defaultValue: "Analyzed locally. Nothing was signed or broadcast." })}
        </span>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
        {facts.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-[13px] text-muted">{f.label}</dt>
            <dd className="v2-num text-[15px] text-foreground mt-0.5 break-words">{f.value}</dd>
          </div>
        ))}
      </dl>
      {!complete && (
        <p className="flex items-start gap-2 text-[13px] text-severity-medium">
          <TriangleAlert size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
          {t("psbt.incomplete", { defaultValue: "Some inputs are missing UTXO data. Fee calculation may be incomplete." })}
        </p>
      )}
    </section>
  );
}
