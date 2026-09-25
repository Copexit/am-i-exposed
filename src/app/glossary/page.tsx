"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Search, X, ExternalLink } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { KnowledgeTabBar } from "@/components/KnowledgeTabBar";
import { useTranslation } from "react-i18next";
import { GLOSSARY_ITEMS, GLOSSARY_DEFAULTS } from "@/data/glossary";

export default function GlossaryPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");

  const grouped = useMemo(() => {
    const items = filter.trim()
      ? GLOSSARY_ITEMS.filter((item) => {
          const q = filter.toLowerCase();
          const term = t(item.termKey, { defaultValue: GLOSSARY_DEFAULTS[item.termKey] }).toLowerCase();
          const def = t(item.defKey, { defaultValue: GLOSSARY_DEFAULTS[item.defKey] }).toLowerCase();
          return term.includes(q) || def.includes(q);
        })
      : GLOSSARY_ITEMS;

    const groups: { letter: string; items: typeof GLOSSARY_ITEMS }[] = [];
    for (const item of items) {
      const term = t(item.termKey, { defaultValue: GLOSSARY_DEFAULTS[item.termKey] });
      const letter = term.charAt(0).toUpperCase();
      let group = groups.at(-1);
      if (group?.letter !== letter) {
        group = { letter, items: [] };
        groups.push(group);
      }
      group.items.push(item);
    }
    return groups;
  }, [filter, t]);

  return (
    <PageShell backLabel={t("glossary.back", { defaultValue: "Back to scanner" })} spacing="space-y-8">
        <KnowledgeTabBar />

        {/* Title + search */}
        <div className="space-y-4">
          <div className="space-y-3">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              {t("glossary.title", { defaultValue: "Bitcoin Privacy Glossary" })}
            </h1>
            <p className="text-muted text-lg leading-relaxed max-w-2xl">
              {t("glossary.subtitle", { defaultValue: "Key terms and concepts for understanding Bitcoin on-chain privacy." })}
            </p>
          </div>

          {/* Search filter */}
          <div className="relative max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("glossary.search", { defaultValue: "Filter terms..." })}
              aria-label={t("glossary.search", { defaultValue: "Filter terms..." })}
              className={`w-full pl-9 ${filter ? "pr-8" : "pr-4"} py-2.5 text-sm bg-surface-elevated/50 border border-card-border rounded-lg text-foreground placeholder:text-muted/70 focus:border-bitcoin/30 focus-visible:outline-2 focus-visible:outline-bitcoin/50 transition-colors`}
            />
            {filter && (
              <button
                onClick={() => setFilter("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors cursor-pointer"
                aria-label={t("glossary.clearFilter", { defaultValue: "Clear filter" })}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Terms */}
        <div className="space-y-8">
          {grouped.length === 0 && (
            <div className="text-center py-12 space-y-2">
              <p className="text-sm text-muted">
                {t("glossary.noResults", { defaultValue: "No matching terms found." })}
              </p>
              <button
                onClick={() => setFilter("")}
                className="text-sm text-bitcoin hover:text-bitcoin/80 transition-colors cursor-pointer"
              >
                {t("glossary.clearFilter", { defaultValue: "Clear filter" })}
              </button>
            </div>
          )}
          {grouped.map(({ letter, items }) => (
            <section key={letter} aria-label={t("glossary.sectionLabel", { letter, defaultValue: "Terms starting with {{letter}}" })}>
              <h2 className="text-sm font-bold text-muted uppercase tracking-widest mb-3 ml-1 flex items-center gap-3">
                {letter}
                <span className="flex-1 h-px bg-card-border" />
              </h2>
              <dl className="space-y-3">
                {items.map((item) => (
                  <div
                    key={item.id}
                    id={item.id}
                    className="rounded-xl border border-card-border bg-surface-elevated/50 px-5 py-4 space-y-1.5 hover:border-card-border/80 hover:bg-surface-elevated/70 transition-colors"
                  >
                    <dt className="text-sm font-semibold text-foreground">
                      {t(item.termKey, { defaultValue: GLOSSARY_DEFAULTS[item.termKey] })}
                    </dt>
                    <dd className="text-sm text-muted leading-relaxed">
                      {t(item.defKey, { defaultValue: GLOSSARY_DEFAULTS[item.defKey] })}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        {/* CTA */}
        <div className="text-center space-y-2">
          <p className="text-sm text-muted">
            {t("glossary.cta", { defaultValue: "Ready to analyze a transaction? See these concepts in action." })}
          </p>
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
              {t("glossary.scanNow", { defaultValue: "Scan now" })}
            </Link>
          </div>
        </div>
    </PageShell>
  );
}
