"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MAX_LABEL_LENGTH } from "@/lib/wallet/bip329";

interface BatchBarProps {
  count: number;
  onLabel: (label: string) => void;
  onHide: () => void;
  onIsolate: (hops: 1 | 2) => void;
  onRemove: () => void;
  onSelectAll: () => void;
  onClear: () => void;
}

const btn = "inline-flex items-center justify-center min-h-8 px-2.5 rounded-lg border border-card-border text-xs text-muted hover:text-foreground hover:bg-surface-inset transition-colors cursor-pointer";

/** Floating actions for the multi-selection, at the bottom of the canvas. */
export function BatchBar({ count, onLabel, onHide, onIsolate, onRemove, onSelectAll, onClear }: BatchBarProps) {
  const { t } = useTranslation();
  const [labelText, setLabelText] = useState<string | null>(null);

  const applyLabel = (e: React.FormEvent) => {
    e.preventDefault();
    if (labelText === null) return;
    onLabel(labelText.trim());
    setLabelText(null);
  };

  return (
    <div
      role="toolbar"
      aria-label={t("graph.batch.title", { defaultValue: "Selection actions" })}
      data-testid="graph-batch-bar"
      className="absolute z-20 bottom-2 inset-x-2 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:max-w-[calc(100%-1rem)] rounded-xl border border-card-border bg-card-bg/95 backdrop-blur-xl shadow-(--shadow-pop) px-2 py-1.5 flex flex-wrap items-center gap-1.5"
    >
      <span className="text-xs text-foreground font-medium tabular-nums px-1" aria-live="polite">
        {t("graph.batch.count", { count, defaultValue: "{{count}} selected" })}
      </span>
      {labelText !== null ? (
        <form onSubmit={applyLabel} className="flex items-center gap-1.5 w-full sm:w-auto sm:flex-1 min-w-0">
          <input
            autoFocus
            value={labelText}
            onChange={(e) => setLabelText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setLabelText(null); } }}
            maxLength={MAX_LABEL_LENGTH}
            aria-label={t("graph.batch.labelInput", { defaultValue: "Label for the selected nodes" })}
            placeholder={t("graph.batch.labelInput", { defaultValue: "Label for the selected nodes" })}
            className="h-8 flex-1 min-w-0 sm:w-56 px-2 rounded-lg border border-card-border bg-surface-inset text-xs text-foreground outline-none focus:border-bitcoin/60"
          />
          <button type="submit" className={btn}>{t("graph.batch.apply", { defaultValue: "Apply" })}</button>
          <button type="button" className={btn} onClick={() => setLabelText(null)}>{t("graph.batch.cancel", { defaultValue: "Cancel" })}</button>
        </form>
      ) : (
        <>
          <button type="button" className={btn} onClick={() => setLabelText("")}>{t("graph.batch.label", { defaultValue: "Label" })}</button>
          <button type="button" className={btn} onClick={onHide}>{t("graph.batch.hide", { defaultValue: "Hide" })}</button>
          <button type="button" className={btn} onClick={() => onIsolate(1)}>{t("graph.batch.isolate1", { defaultValue: "Isolate 1 hop" })}</button>
          <button type="button" className={btn} onClick={() => onIsolate(2)}>{t("graph.batch.isolate2", { defaultValue: "Isolate 2 hops" })}</button>
          <button type="button" className={`${btn} hover:text-severity-critical`} onClick={onRemove}>{t("graph.batch.remove", { defaultValue: "Remove" })}</button>
          <button type="button" className={btn} onClick={onSelectAll}>{t("graph.batch.selectAll", { defaultValue: "Select all visible" })}</button>
          <button type="button" className={btn} onClick={onClear}>{t("graph.batch.clear", { defaultValue: "Clear" })}</button>
        </>
      )}
    </div>
  );
}
