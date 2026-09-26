"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Share2, ChevronDown } from "lucide-react";
import { BookmarkButton } from "@/components/BookmarkButton";
import { ExportButton } from "@/components/ExportButton";
import { ShareButtons } from "@/components/ShareButtons";
import { ShareCardV2Button } from "@/components/v2/pages/ShareCardV2Button";
import { findingKeys } from "@/lib/finding-utils";
import type { ScoringResult } from "@/lib/types";
import type { ResultViewModel } from "@/lib/view/tx-view-model";

/** Save, plus one Share menu (card, X, copy link, copy report). Counts come from the view model. */
export function ResultActions({ query, inputType, result, vm }: {
  query: string;
  inputType: "txid" | "address";
  result: ScoringResult;
  vm: ResultViewModel;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); toggleRef.current?.focus(); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const findingCount = vm.visible.length;
  // Top leak: the visible finding that cost the most points (none when nothing cost points).
  const worst = [...vm.visible].filter((f) => f.scoreImpact < 0).sort((a, b) => a.scoreImpact - b.scoreImpact)[0];
  const topLeak = worst ? t(findingKeys(worst.id, "title", worst.params), { ...worst.params, defaultValue: worst.title }) : null;
  const txType = inputType === "txid" && vm.txType && vm.txType !== "unknown"
    ? t(`txType.${vm.txType}`, { defaultValue: vm.txType.replace(/-/g, " ") })
    : null;

  return (
    <div className="flex items-center gap-2" ref={ref}>
      <BookmarkButton query={query} inputType={inputType} grade={result.grade} score={result.score} />
      <div className="relative">
        <button
          ref={toggleRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="true"
          className="inline-flex items-center gap-2 h-11 px-4 rounded-lg border border-hairline-strong text-sm text-foreground hover:bg-surface-2 transition-colors"
        >
          <Share2 size={15} aria-hidden="true" />
          {t("v2.results.share", { defaultValue: "Share" })}
          <ChevronDown size={14} className={`text-faint transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-2 z-40 w-[min(92vw,300px)] rounded-xl border border-hairline-strong bg-surface-float p-3 shadow-(--shadow-pop) flex flex-col items-stretch gap-2 [&_button]:w-full [&_button]:justify-start">
            <ShareCardV2Button grade={result.grade} score={result.score} query={query} inputType={inputType} findingCount={findingCount} txType={txType} topLeak={topLeak} />
            <ShareButtons grade={result.grade} score={result.score} query={query} inputType={inputType} findingCount={findingCount} />
            <ExportButton targetId="results-panel" query={query} result={result} inputType={inputType} />
          </div>
        )}
      </div>
    </div>
  );
}
