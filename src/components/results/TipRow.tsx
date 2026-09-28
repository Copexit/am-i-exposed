"use client";

import { useTranslation } from "react-i18next";
import { Heart, Zap } from "lucide-react";
import { COINOS_PAY_URL } from "@/lib/constants";

/** The tip prompt as an inline card at the end of a result (no floating toasts over results). */
export function TipRow() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 rounded-xl border border-bitcoin/25 bg-bitcoin/5 px-4 py-3.5">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <span className="grid place-items-center size-9 shrink-0 rounded-full bg-bitcoin/15 text-bitcoin" aria-hidden="true">
          <Heart size={16} />
        </span>
        <p className="text-sm text-foreground leading-snug">
          {t("common.tipToastMessage", { defaultValue: "This tool is free and open source. Tip to keep it running." })}
        </p>
      </div>
      <a
        href={COINOS_PAY_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center gap-2 min-h-[44px] shrink-0 rounded-lg bg-bitcoin px-4 text-sm font-semibold text-black hover:bg-bitcoin/90 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bitcoin"
      >
        <Zap size={15} aria-hidden="true" />
        {t("common.tipViaCoinos", { defaultValue: "Tip via Bitcoin or Lightning" })}
      </a>
    </div>
  );
}
