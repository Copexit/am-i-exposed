"use client";

import { useTranslation } from "react-i18next";
import { FastForward } from "lucide-react";

/** Small "Skip" control shown while the reveal plays. Jumps to the end state. */
export function RevealSkip({ onSkip, className = "" }: { onSkip: () => void; className?: string }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onSkip}
      data-testid="reveal-skip"
      className={`inline-flex items-center gap-1.5 min-h-11 sm:min-h-8 px-3 rounded-lg text-[13px] text-muted border border-hairline hover:border-hairline-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bitcoin transition-colors cursor-pointer ${className}`}
    >
      <FastForward size={13} aria-hidden="true" />
      {t("v2.scan.skip", { defaultValue: "Skip" })}
    </button>
  );
}
