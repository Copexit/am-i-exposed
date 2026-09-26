"use client";

import { useTranslation } from "react-i18next";
import { Server } from "lucide-react";
import { UMBREL_APP_URL, STARTOS_SETUP_ANCHOR } from "@/lib/external-links";
import { useUiHref } from "@/components/v2/pages/uiHref";

/** The self-host announcement as a quiet row at the end of the home page (no floating toast). */
export function SelfHostRow() {
  const { t } = useTranslation();
  const toUi = useUiHref();
  return (
    <section className="max-w-[1360px] w-full mx-auto px-4 sm:px-6 lg:px-8 pb-16">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-hairline pt-6 text-sm">
        <Server size={16} className="text-bitcoin shrink-0" aria-hidden="true" />
        <span className="text-foreground">{t("appstore.announce_title", { defaultValue: "Run am-i.exposed on your own node" })}</span>
        <span className="text-muted">{t("appstore.announce_desc", { defaultValue: "Now in the official Umbrel & StartOS app stores - 100% local and private." })}</span>
        <span className="flex gap-4">
          <a href={UMBREL_APP_URL} target="_blank" rel="noopener noreferrer" className="text-bitcoin hover:underline underline-offset-4">
            {t("appstore.cta_umbrel", { defaultValue: "Umbrel" })}
          </a>
          <a href={toUi(STARTOS_SETUP_ANCHOR)} className="text-bitcoin hover:underline underline-offset-4">
            {t("appstore.cta_startos", { defaultValue: "StartOS" })}
          </a>
        </span>
      </div>
    </section>
  );
}
