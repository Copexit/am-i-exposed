"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { truncateId } from "@/lib/constants";
import { fmtN } from "@/lib/format";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import type { Bip329Record } from "@/lib/wallet/bip329";
import type { Bip329Merge } from "@/lib/wallet/bip329-merge";

const shortRef = (ref: string) => ref.split(":").map((p) => truncateId(p)).join(":");

/**
 * Review of a BIP329 import before it is applied: counts, then every label
 * that clashes with an existing one. Existing labels are kept unless a row
 * (or "use all incoming") is ticked. Shared by the graph and wallet imports.
 */
export function Bip329ConflictPreview({ merge, unmatched = 0, onApply, onCancel }: {
  merge: Bip329Merge;
  /** Records that map to nothing here (graph import only) */
  unmatched?: number;
  onApply: (replaceKeys: Set<string>) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const all = merge.conflicts.length > 0 && picked.size === merge.conflicts.length;

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);
  // Modal: keys never reach the page's shortcuts (the graph's s/o/r/u/Escape...). Capture phase, so it runs first; Tab is left to the focus trap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") return;
      e.stopPropagation();
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);
  const flag = (r: Bip329Record, other: Bip329Record) => r.spendable !== undefined && r.spendable !== other.spendable
    ? <span className="ml-1.5 rounded border border-card-border px-1 text-[11px] text-muted">{r.spendable ? t("labels.preview.spendable", { defaultValue: "spendable" }) : t("labels.preview.frozen", { defaultValue: "frozen" })}</span>
    : null;

  const toggle = (key: string) => setPicked((p) => { const n = new Set(p); if (!n.delete(key)) n.add(key); return n; });
  const stat = (key: string, count: number, def: string) => (
    <li>{t(key, { count, n: fmtN(count), defaultValue: def })}</li>
  );

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" data-testid="labels-preview" data-labels-preview>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} className="w-full sm:max-w-3xl max-h-[90dvh] flex flex-col rounded-t-2xl sm:rounded-xl border border-glass-border p-4 gap-3" style={{ background: "var(--card-bg)", boxShadow: "var(--glass-shadow)" }}>
        <h2 id={`${id}-t`} className="text-base font-semibold text-foreground">{t("labels.preview.title", { defaultValue: "Review the label import" })}</h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted num">
          {stat("labels.preview.added", merge.added.length, "{{n}} new")}
          {stat("labels.preview.unchanged", merge.unchanged, "{{n}} unchanged")}
          {stat("labels.preview.conflicts", merge.conflicts.length, "{{n}} conflicts")}
          {unmatched > 0 && stat("labels.preview.unmatched", unmatched, "{{n}} not in this graph")}
        </ul>
        {merge.conflicts.length > 0 && (
          <>
            <p className="text-[13px] text-muted leading-relaxed">{t("labels.preview.note", { defaultValue: "Existing labels are kept unless an incoming one is ticked." })}</p>
            <label className="inline-flex items-center gap-2 min-h-10 text-sm text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={all}
                onChange={() => setPicked(all ? new Set() : new Set(merge.conflicts.map((c) => c.key)))}
                className="size-4 accent-bitcoin"
              />
              {t("labels.preview.useAll", { defaultValue: "Use all incoming" })}
            </label>
            <div className="overflow-auto min-h-0 max-h-[50dvh] border border-card-border rounded-lg" data-testid="labels-conflicts">
              <table className="w-full text-[13px] text-left">
                <thead className="sticky top-0 bg-surface-inset text-muted">
                  <tr>
                    <th scope="col" className="px-2 py-1.5 font-medium w-8"><span className="sr-only">{t("labels.preview.use", { defaultValue: "Use incoming" })}</span></th>
                    <th scope="col" className="px-2 py-1.5 font-medium">{t("labels.preview.ref", { defaultValue: "Reference" })}</th>
                    <th scope="col" className="px-2 py-1.5 font-medium">{t("labels.preview.existing", { defaultValue: "Existing" })}</th>
                    <th scope="col" className="px-2 py-1.5 font-medium">{t("labels.preview.incoming", { defaultValue: "Incoming" })}</th>
                  </tr>
                </thead>
                <tbody>
                  {merge.conflicts.map((c) => (
                    <tr key={c.key} className="border-t border-hairline align-top">
                      <td className="p-0"><label className="flex items-center justify-center min-h-10 min-w-10 cursor-pointer"><input
                          type="checkbox"
                          checked={picked.has(c.key)}
                          onChange={() => toggle(c.key)}
                          aria-label={t("labels.preview.useFor", { ref: shortRef(c.existing.ref), defaultValue: "Use the incoming label for {{ref}}" })}
                          className="size-4 accent-bitcoin"
                        /></label></td>
                      <td className="px-2 py-1 num text-muted text-[11px] break-all max-w-[7rem] sm:max-w-none">{c.existing.type} {shortRef(c.existing.ref)}</td>
                      <td className="px-2 py-1 text-foreground break-words min-w-[6rem]">{c.existing.label ?? ""}{flag(c.existing, c.incoming)}</td>
                      <td className="px-2 py-1 text-foreground break-words min-w-[6rem]">{c.incoming.label ?? ""}{flag(c.incoming, c.existing)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancel} className="h-10 px-4 rounded-lg border border-card-border text-sm text-foreground hover:border-bitcoin/50 transition-colors cursor-pointer">
            {t("common.cancel", { defaultValue: "Cancel" })}
          </button>
          <button type="button" autoFocus onClick={() => onApply(picked)} className="h-10 px-4 bg-bitcoin text-black font-semibold text-sm rounded-lg hover:bg-bitcoin-hover transition-colors cursor-pointer">
            {t("labels.preview.apply", { defaultValue: "Apply import" })}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
