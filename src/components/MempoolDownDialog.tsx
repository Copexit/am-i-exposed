"use client";

import { useNetwork } from "@/context/NetworkContext";
import { useTranslation } from "react-i18next";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Blocking overlay shown when the app is running on Umbrel
 * but the local mempool API is unreachable.
 *
 * Covers the entire viewport so the user can't miss it.
 * They can dismiss it to poke around, but the warning is clear.
 */
export function MempoolDownDialog() {
  const { isUmbrel, localApiStatus } = useNetwork();
  const { t } = useTranslation();

  if (!isUmbrel || localApiStatus !== "unavailable") return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="glass rounded-2xl border border-warning/30 max-w-md w-full p-6 space-y-4 shadow-lg shadow-warning/5">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-warning/15 p-2.5">
            <AlertTriangle size={24} className="text-warning" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">
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
                defaultValue: "Open your Umbrel dashboard",
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
          onClick={() => window.location.reload()}
          className="w-full inline-flex items-center justify-center gap-2 text-sm font-medium bg-warning/15 hover:bg-warning/25 text-warning rounded-lg px-4 py-3 transition-colors cursor-pointer"
        >
          <RefreshCw size={14} />
          {t("umbrel.mempoolDownReload", { defaultValue: "Reload Page" })}
        </button>
      </div>
    </div>
  );
}
