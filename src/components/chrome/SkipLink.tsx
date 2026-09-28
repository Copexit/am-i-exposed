"use client";

import { useTranslation } from "react-i18next";

/** First focusable element: jumps keyboard users past the header. */
export function SkipLink() {
  const { t } = useTranslation();
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-bitcoin focus:text-black focus:rounded-lg focus:text-sm focus:font-medium"
    >
      {t("common.skipToContent", { defaultValue: "Skip to main content" })}
    </a>
  );
}
