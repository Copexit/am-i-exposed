"use client";

import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MAINTENANCE_SECTIONS } from "@/data/guide/maintenance";

export function MaintenanceSection() {
  const { t } = useTranslation();

  return (
    <section className="space-y-4">
      <h2 id="maintaining-privacy" className="text-2xl font-bold text-foreground scroll-mt-24">
        <ShieldCheck size={20} className="inline mr-2 text-severity-good" />
        {t("guide.maintenanceTitle", { defaultValue: "Maintaining your privacy" })}
      </h2>
      <p className="text-base text-muted leading-relaxed">
        {t("maintenance.intro", {
          defaultValue: "Good privacy is not a one-time achievement - it requires ongoing discipline. These practices help maintain the privacy gains detected in this analysis.",
        })}
      </p>
      {MAINTENANCE_SECTIONS.map((section) => (
        <div
          key={section.titleKey}
          className="bg-severity-good/5 border border-severity-good/15 rounded-lg px-4 py-3"
        >
          <p className="text-base font-medium text-foreground/90 mb-1.5">
            {t(section.titleKey, { defaultValue: section.titleDefault })}
          </p>
          <ul className="space-y-1">
            {section.tipsKeys.map((tip) => (
              <li key={tip.key} className="flex items-start gap-2 text-sm text-muted leading-relaxed">
                <span className="text-severity-good shrink-0 mt-0.5">-</span>
                {t(tip.key, { defaultValue: tip.default })}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
