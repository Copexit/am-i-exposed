"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useNetwork } from "@/context/NetworkContext";
import { useTranslation } from "react-i18next";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Blocking overlay shown when the app is running on a self-hosted backend
 * (Umbrel, StartOS, or a manual install) but the local mempool API is unreachable.
 *
 * Covers the entire viewport so the user can't miss it.
 * They can dismiss it (button or Escape) to poke around, but the warning is clear.
 */
export function MempoolDownDialog() {
  const { isUmbrel, localApiStatus } = useNetwork();
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const reloadRef = useRef<HTMLButtonElement>(null);
  const open = isUmbrel && localApiStatus === "unavailable" && !dismissed;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    reloadRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDismissed(true);
      if (e.key !== "Tab") return;
      // Keep focus on the dialog's buttons while it is modal.
      const buttons = dialogRef.current?.querySelectorAll("button");
      if (!buttons?.length) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      const inside = dialogRef.current?.contains(active);
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="glass rounded-2xl border border-warning/30 max-w-md w-full p-6 space-y-4 shadow-lg shadow-warning/5">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-warning/15 p-2.5">
            <AlertTriangle size={24} className="text-warning" />
          </div>
          <h2 id={titleId} className="text-lg font-semibold text-foreground">
            {t("umbrel.mempoolDownTitle", { defaultValue: "Mempool Unreachable" })}
          </h2>
        </div>

        <p className="text-sm text-muted leading-relaxed">
          {t("umbrel.mempoolDownBody", {
            defaultValue:
              "The local mempool instance is not responding. Privacy analysis requires a working mempool API to fetch blockchain data.",
          })}
        </p>

        <div className="bg-surface-inset rounded-lg p-3 space-y-2">
          <p className="text-xs font-medium text-foreground/80">
            {t("umbrel.mempoolDownSteps", { defaultValue: "To fix this:" })}
          </p>
          <ol className="text-xs text-muted space-y-1 list-decimal list-inside">
            <li>
              {t("umbrel.mempoolDownStep1", {
                defaultValue: "Open your server dashboard (Umbrel, StartOS, etc.)",
              })}
            </li>
            <li>
              {t("umbrel.mempoolDownStep2", {
                defaultValue: "Go to the mempool app and restart it",
              })}
            </li>
            <li>
              {t("umbrel.mempoolDownStep3", {
                defaultValue: "Wait for it to finish syncing, then reload this page",
              })}
            </li>
          </ol>
        </div>

        <button
          ref={reloadRef}
          onClick={() => window.location.reload()}
          className="w-full inline-flex items-center justify-center gap-2 text-sm font-medium bg-warning/15 hover:bg-warning/25 text-warning rounded-lg px-4 py-3 transition-colors cursor-pointer"
        >
          <RefreshCw size={14} />
          {t("umbrel.mempoolDownReload", { defaultValue: "Reload Page" })}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="w-full text-sm text-muted hover:text-foreground rounded-lg px-4 py-2 transition-colors cursor-pointer"
        >
          {t("common.dismiss", { defaultValue: "Dismiss" })}
        </button>
      </div>
    </div>
  );
}
