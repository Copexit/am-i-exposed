"use client";

import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import { LANGUAGE_OPTIONS } from "@/lib/i18n/config";

export function LanguageSelector() {
  const { i18n } = useTranslation();
  const currentCode = i18n.language?.split("-")[0] ?? "en";
  const currentFlag =
    LANGUAGE_OPTIONS.find((l) => l.code === currentCode)?.flag ?? LANGUAGE_OPTIONS[0].flag;

  return (
    <div className="relative">
      <select
        value={currentCode}
        onChange={(e) => i18n.changeLanguage(e.target.value)}
        className="appearance-none bg-card-bg border border-card-border rounded-lg py-2.5 min-h-[44px]
          text-sm text-foreground cursor-pointer hover:border-muted transition-colors
          focus-visible:border-bitcoin
          pl-7 pr-5 sm:pl-2.5 sm:pr-7 text-[0px] sm:text-sm"
        aria-label="Select language"
      >
        {LANGUAGE_OPTIONS.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.flag} {lang.label}
          </option>
        ))}
      </select>
      {/* Flag overlay visible on mobile when select text is hidden */}
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm pointer-events-none sm:hidden">
        {currentFlag}
      </span>
      <ChevronDown
        size={14}
        className="absolute right-1 sm:right-1.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
      />
    </div>
  );
}
