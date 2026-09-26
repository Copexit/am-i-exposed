"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GRADE_COLORS } from "@/lib/constants";
import type { Grade } from "@/lib/types";


/** Sticky in-page section chips; highlights the section in view. */
export function SectionNav({ hasAnalyst, inputType, grade, score }: {
  hasAnalyst: boolean;
  inputType: "txid" | "address";
  grade: Grade;
  score: number;
}) {
  const { t } = useTranslation();
  const [active, setActive] = useState<string>("v2-overview");
  const sections = [
    { id: "v2-overview", label: t("v2.results.navOverview", { defaultValue: "Overview" }) },
    { id: "v2-evidence", label: inputType === "txid" ? t("v2.results.navEvidence", { defaultValue: "Transaction" }) : t("v2.results.navEvidenceAddr", { defaultValue: "Address" }) },
    { id: "v2-findings", label: t("v2.results.navFindings", { defaultValue: "Findings" }) },
    { id: "v2-explain", label: t("v2.results.navExplain", { defaultValue: "Score" }) },
    ...(hasAnalyst ? [{ id: "v2-analyst", label: t("v2.results.navAnalyst", { defaultValue: "Analyst tools" }) }] : []),
  ];

  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: "-120px 0px -60% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- section list only changes with hasAnalyst
  }, [hasAnalyst]);

  return (
    <nav
      aria-label={t("v2.results.navLabel", { defaultValue: "Result sections" })}
      className="sticky top-[var(--v2-header-h,56px)] z-30 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-2 bg-background/85 backdrop-blur border-b border-hairline"
    >
      <div className="flex items-center gap-3">
      {/* The grade stays in view while scrolling (replaces a floating pill that covered content). */}
      <span className="shrink-0 flex items-baseline gap-1.5 pr-3 border-r border-hairline" aria-label={t("score.ariaLabel", { score, grade, defaultValue: "Privacy score: {{score}} out of 100, grade {{grade}}" })}>
        <span className={`text-base font-semibold leading-none ${GRADE_COLORS[grade]}`}>{grade}</span>
        <span className="v2-num text-xs text-muted">{score}</span>
      </span>
      <ul className="flex gap-1 overflow-x-auto no-scrollbar [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)]">
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              onClick={(e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
              aria-current={active === s.id ? "true" : undefined}
              className={`inline-flex items-center min-h-[36px] px-3 rounded-md text-sm whitespace-nowrap transition-colors ${active === s.id ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}
            >
              {s.label}
            </a>
          </li>
        ))}
      </ul>
      </div>
    </nav>
  );
}
