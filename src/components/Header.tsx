"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { NetworkSelector } from "./NetworkSelector";
import { ConnectionBadge } from "./ConnectionBadge";
import { ApiSettings } from "./ApiSettings";
import { LanguageSelector } from "./LanguageSelector";

export function Header() {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-50 border-b border-card-border bg-background/80 backdrop-blur-md">
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 max-w-6xl mx-auto w-full">
        <div className="flex items-center">
          <Link
            href="/"
            aria-label="am-i.exposed home"
            className="flex items-center gap-2 group hover:opacity-80 transition-opacity"
          >
            <span className="text-xl sm:text-2xl font-bold tracking-tight text-foreground select-none whitespace-nowrap">
              am-i.<span className="text-danger">exposed</span>
            </span>
          </Link>
          <nav className="hidden sm:flex items-center gap-1 ml-4" aria-label="Main navigation">
            <Link
              href="/methodology/"
              className="text-sm text-muted hover:text-foreground transition-colors px-2 py-1 rounded"
            >
              {t("common.methodology", { defaultValue: "Methodology" })}
            </Link>
            <Link
              href="/setup-guide/"
              className="text-sm text-muted hover:text-foreground transition-colors px-2 py-1 rounded"
            >
              {t("common.setupGuide", { defaultValue: "Setup Guide" })}
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <ConnectionBadge />
          <ApiSettings />
          <NetworkSelector />
          <LanguageSelector />
        </div>
      </div>
    </header>
  );
}
