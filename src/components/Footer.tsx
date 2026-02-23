"use client";

import Link from "next/link";
import { Github } from "lucide-react";
import { useTranslation } from "react-i18next";

export function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="flex flex-col sm:flex-row flex-wrap items-center justify-center gap-x-4 gap-y-2 px-6 sm:px-4 py-5 text-sm text-muted border-t border-card-border max-w-6xl mx-auto w-full">
      <span className="font-medium text-foreground">am-i.exposed</span>
      <span className="text-muted">{t("common.tagline", { defaultValue: "Your privacy. Diagnosed." })}</span>
      <span className="text-xs text-muted/60">
        by Copexit &{" "}
        <a
          href="https://x.com/multicripto"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground transition-colors"
        >
          Arkad
        </a>
      </span>
      <Link
        href="/methodology"
        className="text-muted hover:text-foreground transition-colors py-3"
      >
        {t("common.methodology", { defaultValue: "Methodology" })}
      </Link>
      <Link
        href="/setup-guide"
        className="text-muted hover:text-foreground transition-colors py-3"
      >
        {t("common.setupGuide", { defaultValue: "Setup Guide" })}
      </Link>
      <a
        href="https://github.com/Copexit/am-i-exposed"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-muted hover:text-foreground transition-colors py-3"
      >
        <Github size={16} />
        GitHub
      </a>
    </footer>
  );
}
