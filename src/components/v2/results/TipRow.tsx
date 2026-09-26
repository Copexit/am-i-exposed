"use client";

import { useTranslation } from "react-i18next";
import { COINOS_PAY_URL } from "@/lib/constants";

/** The tip prompt as a quiet inline row (v2 has no floating toasts over results). */
export function TipRow() {
  const { t } = useTranslation();
  return (
    <p className="text-xs text-faint">
      {t("common.tipToastMessage", { defaultValue: "This tool is free and open source. Tip to keep it running." })}{" "}
      <a href={COINOS_PAY_URL} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-bitcoin underline underline-offset-4">
        {t("common.tipViaCoinos", { defaultValue: "Tip via Bitcoin, Lightning, or Liquid" })}
      </a>
    </p>
  );
}
