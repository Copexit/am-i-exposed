"use client";

import { useTranslation } from "react-i18next";
import { forgetWallet } from "@/lib/wallet/saved-wallets";

/** Removing a wallet bookmark: optionally forget its saved scan too. `onDone(false)` = cancelled. */
export function RemoveWalletBookmarkPrompt({ snapshotKey, onDone }: { snapshotKey?: string; onDone: (removed: boolean) => void }) {
  const { t } = useTranslation();
  const link = "text-left text-xs min-h-[32px] cursor-pointer transition-colors";
  return (
    <div role="group" aria-label={t("wallet.bookmark.removeTitle", { defaultValue: "Remove this wallet bookmark?" })}
      className="rounded-lg border border-card-border bg-surface-elevated p-3 shadow-lg space-y-1"
      onKeyDown={(e) => { if (e.key === "Escape") onDone(false); }}>
      <p className="text-xs text-foreground mb-1">{t("wallet.bookmark.removeTitle", { defaultValue: "Remove this wallet bookmark?" })}</p>
      <div className="flex flex-col">
        {snapshotKey && (
          <button type="button" autoFocus className={`${link} text-severity-high hover:text-foreground`}
            onClick={async () => { await forgetWallet(snapshotKey); onDone(true); }}>
            {t("wallet.bookmark.removeForget", { defaultValue: "Remove and forget its saved scan" })}
          </button>
        )}
        <button type="button" autoFocus={!snapshotKey} className={`${link} text-foreground hover:text-bitcoin`} onClick={() => onDone(true)}>
          {t("wallet.bookmark.removeOnly", { defaultValue: "Remove the bookmark only" })}
        </button>
        <button type="button" className={`${link} text-muted hover:text-foreground`} onClick={() => onDone(false)}>
          {t("wallet.bookmark.cancel", { defaultValue: "Cancel" })}
        </button>
      </div>
    </div>
  );
}
