"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { ConnectionBadge } from "./ConnectionBadge";
import { ApiSettings } from "./ApiSettings";

export function Header() {
  const { t } = useTranslation();

  return (
    <header
      className="fixed top-0 w-full sm:top-3 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-4xl sm:w-[calc(100%-2rem)] sm:rounded-2xl z-50 border-b sm:border-b-0 border-glass-border glass"
      style={{
        backdropFilter: "blur(16px) saturate(180%)",
        WebkitBackdropFilter: "blur(16px) saturate(180%)",
        borderTop: "1px solid rgba(255,255,255,0.1)",
      }}
    >
      <div className="flex items-center justify-between px-4 sm:px-6 py-4">
        <div className="flex items-center">
          <button
            onClick={() => {
              if (window.location.pathname !== "/") {
                window.location.href = "/";
              } else {
                window.location.hash = "";
              }
            }}
            aria-label="am-i.exposed home"
            className="flex items-center gap-2 group hover:opacity-80 transition-opacity cursor-pointer"
          >
            <span className="text-xl sm:text-2xl font-bold tracking-tight text-foreground select-none whitespace-nowrap">
              am-i.<span className="gradient-text">exposed</span>
            </span>
          </button>
          <nav className="hidden sm:flex items-center gap-1 ml-4" aria-label="Main navigation">
            <Link
              href="/methodology/"
              className="text-sm text-muted hover:text-foreground transition-colors px-2 py-1 rounded"
            >
              {t("common.methodology", { defaultValue: "Methodology" })}
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <ConnectionBadge />
          <ApiSettings />
        </div>
      </div>
    </header>
  );
}
