"use client";

import { PageShell } from "@/components/PageShell";
import { useTranslation } from "react-i18next";
import { TOC_ITEMS } from "./setup-guide-data";
import { UmbrelSection, Start9Section } from "./PlatformSections";
import { AdvancedManualSetup } from "./AdvancedManualSetup";

export default function SetupGuidePage() {
  const { t } = useTranslation();

  return (
    <PageShell backLabel={t("setup.back", { defaultValue: "Back to scanner" })}>
        {/* Title */}
        <div className="space-y-3">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            {t("setup.title", { defaultValue: "Connect Your Node" })}
          </h1>
          <p className="text-muted text-lg leading-relaxed max-w-2xl">
            {t("setup.subtitle", { defaultValue: "Run am-i.exposed natively on your own node, with a one-click install on Umbrel or StartOS. Advanced manual setup is available for Docker, bare-metal, and custom mempool instances." })}
          </p>
        </div>

        {/* Table of contents */}
        <nav className="flex flex-wrap gap-2 text-xs" aria-label={t("setup.tocLabel", { defaultValue: "Page sections" })}>
          {TOC_ITEMS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="px-2.5 py-2.5 rounded-lg bg-surface-elevated/50 border border-card-border/50 text-muted hover:text-foreground hover:border-bitcoin/30 transition-all"
            >
              {t(s.labelKey, { defaultValue: s.labelDefault })}
            </a>
          ))}
        </nav>

        {/* Why self-host */}
        <section id="why" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">
            {t("setup.why_title", { defaultValue: "Why Self-Host?" })}
          </h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-4">
            <p className="text-muted leading-relaxed">
              {t("setup.why_p1", { defaultValue: "When you use the public mempool.space API, their servers see your IP address and every address and transaction you query. This creates a log linking your network identity to your Bitcoin activity." })}
            </p>
            <p className="text-muted leading-relaxed">
              {t("setup.why_p2", { defaultValue: "By pointing am-i.exposed at your own node, API requests never leave your local network." })}
            </p>
          </div>
        </section>

        <UmbrelSection />
        <Start9Section />
        <AdvancedManualSetup />

        {/* Verifying */}
        <section id="verify" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">
            {t("setup.verify_title", { defaultValue: "Verifying It Works" })}
          </h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-3">
            <ol className="space-y-2 text-muted leading-relaxed">
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0 font-bold">1.</span>
                <span>{t("setup.verify_step1", { defaultValue: "Click the gear icon in the header and enter your URL (e.g., http://localhost:3006/api)" })}</span>
              </li>
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0 font-bold">2.</span>
                <span>{t("setup.verify_step2", { defaultValue: "Click Apply - you should see a green checkmark and \"Connected. Using custom endpoint.\"" })}</span>
              </li>
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0 font-bold">3.</span>
                <span>{t("setup.verify_step3", { defaultValue: "Run an analysis on any transaction or address - results should load normally" })}</span>
              </li>
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0 font-bold">4.</span>
                <span>{t("setup.verify_step4", { defaultValue: "The gear icon shows an orange dot when a custom endpoint is active" })}</span>
              </li>
            </ol>
          </div>
        </section>

    </PageShell>
  );
}
