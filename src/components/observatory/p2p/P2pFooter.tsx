"use client";

import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";

const SOURCES = [
  { name: "RoboSats", href: "https://learn.robosats.org" },
  { name: "Mostro", href: "https://mostro.network" },
  { name: "HodlHodl", href: "https://hodlhodl.com" },
];

/** Sources, the privacy line and the index source. */
export function P2pFooter({ isUmbrel }: { isUmbrel: boolean }) {
  const { t } = useTranslation();
  return (
    <footer className="space-y-3 border-t border-hairline pt-6 text-sm text-muted">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="eyebrow">{t("observatory.p2p.footer.sources", { defaultValue: "Sources" })}</span>
        {SOURCES.map((s) => (
          <a key={s.name} href={s.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1 text-foreground hover:text-bitcoin">
            {s.name}
            <ExternalLink size={12} aria-hidden="true" className="text-faint" />
          </a>
        ))}
      </div>
      <p className="max-w-3xl leading-relaxed text-pretty">
        {isUmbrel
          ? t("observatory.p2p.footer.privacyUmbrel", { defaultValue: "Data is fetched through Tor on this node. No request from this page carries anything about the visitor." })
          : t("observatory.p2p.footer.privacy", { defaultValue: "Data is fetched through the am-i.exposed relay (or Tor on a self-hosted node). No request from this page carries anything about the visitor." })}
      </p>
      <p className="max-w-3xl text-xs leading-relaxed text-faint text-pretty">
        {t("observatory.p2p.footer.index", { defaultValue: "Index: RoboSats coordinator price, median of blockchain.info and yadio.io. Order events are signature-checked in this browser; trader names, ratings and contact details are never shown." })}
      </p>
    </footer>
  );
}
