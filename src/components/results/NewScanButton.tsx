"use client";

import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { ACTION_BTN_CLASS } from "@/lib/constants";

/** Full-width row with the "New scan" back button shown atop result views. */
export function NewScanButton({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="w-full flex items-center">
      <button onClick={onBack} className={ACTION_BTN_CLASS}>
        <ArrowLeft size={16} />
        {t("results.newScan", { defaultValue: "New scan" })}
      </button>
    </div>
  );
}
