"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Shield, HelpCircle, BookOpen } from "lucide-react";

const TABS = [
  { href: "/guide/", labelKey: "common.guide", labelDefault: "Guide", icon: Shield },
  { href: "/faq/", labelKey: "common.faq", labelDefault: "FAQ", icon: HelpCircle },
  { href: "/glossary/", labelKey: "common.glossary", labelDefault: "Glossary", icon: BookOpen },
] as const;

/**
 * Shared tab bar for knowledge pages (Guide, FAQ, Glossary).
 * Renders at the top of each page, between the back link and the title.
 */
export function KnowledgeTabBar() {
  const { t } = useTranslation();
  const currentPath = usePathname();

  const isActive = (href: string) => {
    const normalized = currentPath.replace(/\/$/, "") || "/";
    const target = href.replace(/\/$/, "") || "/";
    return normalized === target;
  };

  return (
    <nav className="flex items-center gap-1" aria-label="Knowledge sections">
      {TABS.map((tab) => {
        const active = isActive(tab.href);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg transition-colors ${
              active
                ? "text-foreground bg-bitcoin/15 border border-bitcoin/30"
                : "text-muted hover:text-foreground hover:bg-foreground/5 border border-transparent"
            }`}
          >
            <Icon size={14} />
            {t(tab.labelKey, { defaultValue: tab.labelDefault })}
          </Link>
        );
      })}
    </nav>
  );
}
