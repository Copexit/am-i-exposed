"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Github } from "lucide-react";
import { useTranslation } from "react-i18next";
import { classicHref } from "./nav";
import { useLocationHash } from "./useLocationHash";

const LINK = "inline-flex items-center gap-1.5 py-2 text-muted hover:text-foreground transition-colors rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bitcoin";

export function V2Footer() {
  const { t } = useTranslation();
  const pathname = usePathname() ?? "/v2/";
  const hash = useLocationHash();

  // Graph page is full-screen, no footer
  if (/^\/v2\/graph\/?$/.test(pathname)) return null;

  const ext = { target: "_blank", rel: "noopener noreferrer" } as const;

  return (
    <footer className="mt-16 border-t border-hairline">
      <div
        className="mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-8 pt-8 flex flex-col gap-6 md:flex-row md:items-end md:justify-between"
        style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}
      >
        <div className="space-y-1.5">
          <p className="text-[15px] font-semibold tracking-tight text-foreground">
            am-i.<span className="text-bitcoin">exposed</span>
          </p>
          <p className="text-[13px] text-muted">
            {t("common.tagline", { defaultValue: "Your privacy. Diagnosed." })}{" "}
            <span className="text-faint">{t("common.by", { defaultValue: "by" })}</span>{" "}
            <a href="https://github.com/copexit" {...ext} className="text-muted hover:text-foreground transition-colors">Copexit</a>
            {" "}&{" "}
            <a href="https://x.com/multicripto" {...ext} className="text-muted hover:text-foreground transition-colors">Arkad</a>
          </p>
        </div>

        <nav
          aria-label={t("common.footerNavigation", { defaultValue: "Footer navigation" })}
          className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px]"
        >
          <Link href="/v2/setup-guide/" className={LINK}>{t("common.setupGuide", { defaultValue: "Setup Guide" })}</Link>
          <Link href="/v2/agents/" className={LINK}>Agents & CLI</Link>
          <a href="https://github.com/Copexit/am-i-exposed" {...ext} className={LINK}>
            <Github size={14} aria-hidden="true" />
            GitHub
          </a>
          <Link href={classicHref(pathname, hash)} className={LINK}>
            {t("v2.chrome.backToClassic", { defaultValue: "Back to classic" })}
          </Link>
          {process.env.NEXT_PUBLIC_APP_VERSION && (
            <span className="v2-num py-2 text-faint">v{process.env.NEXT_PUBLIC_APP_VERSION}</span>
          )}
        </nav>
      </div>
    </footer>
  );
}
