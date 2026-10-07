"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";

const PROSE = "max-w-[72ch]";

/** Per-page eyebrow + width, keyed by the first path segment. */
function useSection(segment: string): { eyebrow: string; width: string } {
  const { t } = useTranslation();
  switch (segment) {
    case "guide":
    case "faq":
    case "glossary":
      return { eyebrow: t("pages.section.knowledge", { defaultValue: "Knowledge" }), width: PROSE };
    case "about":
    case "welcome":
      return { eyebrow: t("pages.section.about", { defaultValue: "About" }), width: PROSE };
    case "setup-guide":
      return { eyebrow: t("pages.section.selfHost", { defaultValue: "Self-host" }), width: "max-w-4xl" };
    case "agents":
      return { eyebrow: t("pages.section.agents", { defaultValue: "Developers" }), width: "max-w-4xl" };
    case "tutorial":
      return { eyebrow: t("common.tutorial", { defaultValue: "Tutorial" }), width: "max-w-4xl" };
    case "observatory":
      return { eyebrow: t("pages.section.observatory", { defaultValue: "CoinJoin observatory" }), width: "max-w-6xl" };
    default:
      return { eyebrow: "am-i.exposed", width: PROSE };
  }
}

interface PageFrameProps {
  /** Optional page title, for content that brings no <h1> of its own. */
  title?: string;
  /** Tailwind spacing class between children (default "space-y-10"). */
  spacing?: string;
  /** Tighter top padding and breadcrumb margin, for pages whose first screen is the content (Observatory). */
  compact?: boolean;
  /** Overrides the section name in the breadcrumb (a tab with its own title). */
  eyebrow?: string;
  children: ReactNode;
}

/** Calm frame for knowledge and info pages: breadcrumb eyebrow, measured width. */
export function PageFrame({ title, spacing = "space-y-10", compact = false, eyebrow: eyebrowOverride, children }: PageFrameProps) {
  const { t } = useTranslation();
  const segment = (usePathname() ?? "").split("/")[1] ?? "";
  const { eyebrow, width } = useSection(segment);

  return (
    <div className={`flex-1 w-full px-4 sm:px-6 lg:px-8 pb-12 ${compact ? "pt-3 sm:pt-5" : "pt-6 sm:pt-10"}`}>
      <div className={`mx-auto w-full ${width}`}>
        <nav aria-label={t("pages.breadcrumb", { defaultValue: "Breadcrumb" })} className={`eyebrow flex items-center gap-2 ${compact ? "mb-2 sm:mb-3" : "mb-6 sm:mb-8"}`}>
          <Link
            href="/"
            className="inline-flex items-center min-h-11 hover:text-foreground transition-colors rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bitcoin"
          >
            {t("pages.scanner", { defaultValue: "Scanner" })}
          </Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page" className="text-muted">{eyebrowOverride ?? eyebrow}</span>
        </nav>
        {title && (
          <h1 className="text-[28px] sm:text-[40px] leading-tight font-semibold tracking-tight text-foreground text-balance mb-10">
            {title}
          </h1>
        )}
        <div className={spacing}>{children}</div>
      </div>
    </div>
  );
}
