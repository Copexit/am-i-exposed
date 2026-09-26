"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Github } from "lucide-react";
import { useTranslation } from "react-i18next";

export function Footer() {
  const { t } = useTranslation();
  const pathname = usePathname();

  // Graph page is full-screen, no footer
  if (pathname === "/graph" || pathname === "/graph/") return null;

  return (
    <footer className="max-w-6xl mx-auto w-full">
      <div className="gradient-divider" />
      <nav aria-label={t("common.footerNavigation", { defaultValue: "Footer navigation" })} className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 py-4 text-sm text-muted">
        <span className="font-medium text-foreground">am-i.<span className="gradient-text">exposed</span></span>
        <span className="text-muted">{t("common.tagline", { defaultValue: "Your privacy. Diagnosed." })}</span>
        <span className="text-sm text-muted">
          {t("common.by", { defaultValue: "by" })}{" "}
          <a
            href="https://github.com/copexit"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors link-underline py-2 inline-block"
          >
            Copexit
          </a>
          {" "}&{" "}
          <a
            href="https://x.com/multicripto"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors link-underline py-2 inline-block"
          >
            Arkad
          </a>
        </span>
        <Link
          href="/setup-guide/"
          className="text-muted hover:text-foreground transition-colors link-underline py-2 inline-block"
        >
          {t("common.setupGuide", { defaultValue: "Setup Guide" })}
        </Link>
        <Link
          href="/agents/"
          className="text-muted hover:text-foreground transition-colors link-underline py-2 inline-block"
        >
          Agents & CLI
        </Link>
        <a
          href="https://github.com/Copexit/am-i-exposed"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-muted hover:text-foreground transition-colors link-underline py-2"
        >
          <Github size={16} aria-hidden="true" />
          GitHub
        </a>
      </nav>
    </footer>
  );
}
