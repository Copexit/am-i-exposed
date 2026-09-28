"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Closing call to action on knowledge pages: methodology link + "Scan now". */
export function PageCta({ text, scanLabel }: { text: string; scanLabel: string }) {
  const { t } = useTranslation();
  return (
    <div className="text-center space-y-2">
      <p className="text-sm text-muted">{text}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <a
          href="https://github.com/Copexit/am-i-exposed/blob/main/docs/privacy-engine.md"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-lg bg-surface-elevated border border-card-border text-foreground hover:border-bitcoin/30 transition-all"
        >
          {t("common.methodology", { defaultValue: "Methodology" })}
          <ExternalLink size={12} className="text-muted" />
        </a>
        <Link
          href="/"
          className="text-sm px-4 py-2.5 rounded-lg bg-bitcoin text-background font-semibold hover:bg-bitcoin-hover transition-all"
        >
          {scanLabel}
        </Link>
      </div>
    </div>
  );
}
