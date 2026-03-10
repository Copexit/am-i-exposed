"use client";

import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LANGUAGE_OPTIONS } from "@/lib/i18n/config";

export function LocaleSelector() {
  const { t, i18n } = useTranslation();

  return (
    <div className="flex-1">
      <label className="text-xs font-medium text-muted uppercase tracking-wider block mb-1.5">
        {t("settings.language", { defaultValue: "Language" })}
      </label>
      <div className="relative">
        <select
          value={i18n.language?.split("-")[0] ?? "en"}
          onChange={(e) => i18n.changeLanguage(e.target.value)}
          className="appearance-none w-full bg-surface-inset border border-card-border rounded-lg px-3 py-2 text-sm text-foreground cursor-pointer hover:border-muted transition-colors pr-8 focus-visible:border-bitcoin"
          aria-label={t("settings.selectLanguage", { defaultValue: "Select language" })}
        >
          {LANGUAGE_OPTIONS.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.flag} {lang.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
        />
      </div>
    </div>
  );
}
