"use client";

import { XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MISTAKES } from "@/data/guide/mistakes";

export function GuideMistakes() {
  const { t } = useTranslation();

  return (
    <section className="space-y-4">
      <h2 id="common-mistakes" className="text-2xl font-bold text-foreground scroll-mt-24">
        <XCircle size={20} className="inline mr-2 text-severity-high" />
        {t("guide.mistakesTitle", { defaultValue: "Common mistakes to avoid" })}
      </h2>
      <div className="space-y-2">
        {MISTAKES.map((mistake, i) => (
          <div key={i} className="bg-severity-high/5 border border-severity-high/15 rounded-lg px-4 py-3">
            <div className="flex items-start gap-2">
              <XCircle size={16} className="text-severity-high shrink-0 mt-0.5" />
              <div>
                <p className="text-base font-medium text-foreground/90">
                  {t(mistake.titleKey, { defaultValue: mistake.titleDefault })}
                </p>
                <p className="text-sm text-muted mt-1 leading-relaxed">
                  {t(mistake.descKey, { defaultValue: mistake.descDefault })}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
