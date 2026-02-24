"use client";

import Link from "next/link";
import { Github } from "lucide-react";
import { useTranslation } from "react-i18next";

export function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="max-w-6xl mx-auto w-full">
      <div className="gradient-divider" />
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-4 text-sm text-muted">
        <span className="font-medium text-foreground">am-i.<span className="gradient-text">exposed</span></span>
        <span className="text-muted">{t("common.tagline", { defaultValue: "Your privacy. Diagnosed." })}</span>
        <span className="text-xs text-muted/60">
          by{" "}
          <a
            href="https://github.com/copexit"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors link-underline"
          >
            Copexit
          </a>
          {" "}&{" "}
          <a
            href="https://x.com/multicripto"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors link-underline"
          >
            Arkad
          </a>
        </span>
        <Link
          href="/setup-guide"
          className="text-muted hover:text-foreground transition-colors link-underline"
        >
          {t("common.setupGuide", { defaultValue: "Setup Guide" })}
        </Link>
        <a
          href="https://github.com/Copexit/am-i-exposed"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-muted hover:text-foreground transition-colors link-underline"
        >
          <Github size={16} />
          GitHub
        </a>
      </div>
    </footer>
  );
}
