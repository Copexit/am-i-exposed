"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";

/**
 * Shown before importing a file with wallet bookmarks (raw xpubs): the same
 * privacy warning as the bookmark dialog, and wallets only after "I understand".
 */
export function ImportWalletsPrompt({ walletCount, onImport, onCancel }: {
  walletCount: number;
  onImport: (includeWallets: boolean) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [ok, setOk] = useState(false);
  return (
    <div role="group" data-testid="import-wallets-prompt" aria-label={t("history.importWalletsTitle", { count: walletCount, defaultValue: "This file contains {{count}} wallet bookmarks" })}
      className="rounded-lg border border-severity-medium/30 bg-surface-elevated p-3 space-y-2 text-xs"
      onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
      <p className="flex gap-2 font-medium text-foreground">
        <ShieldAlert size={14} className="text-severity-medium shrink-0 mt-0.5" aria-hidden="true" />
        {t("history.importWalletsTitle", { count: walletCount, defaultValue: "This file contains {{count}} wallet bookmarks" })}
      </p>
      <ul className="space-y-1 text-foreground/90 leading-relaxed list-disc pl-5">
        <li>{t("wallet.bookmark.reveals", { defaultValue: "The key (xpub) reveals every past and future address and the balance of this wallet to anyone who can open this browser profile." })}</li>
        <li>{t("wallet.bookmark.ownDevice", { defaultValue: "Use it only on your own device, never on a shared or public computer." })}</li>
        <li>{t("wallet.bookmark.local", { defaultValue: "It is stored in this browser only and never sent anywhere. You can remove it at any time." })}</li>
      </ul>
      <label className="flex items-center gap-2 text-foreground cursor-pointer select-none">
        <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} className="accent-bitcoin" />
        {t("wallet.bookmark.understand", { defaultValue: "I understand" })}
      </label>
      <div className="flex flex-wrap justify-end gap-x-3">
        <button type="button" onClick={onCancel} className="text-muted hover:text-foreground cursor-pointer min-h-[32px]">
          {t("wallet.bookmark.cancel", { defaultValue: "Cancel" })}
        </button>
        <button type="button" autoFocus onClick={() => onImport(false)} className="text-foreground hover:text-bitcoin cursor-pointer min-h-[32px]">
          {t("history.importWithoutWallets", { defaultValue: "Import without wallets" })}
        </button>
        <button type="button" disabled={!ok} onClick={() => onImport(true)} className="text-bitcoin hover:text-bitcoin-hover font-medium cursor-pointer min-h-[32px] disabled:opacity-40 disabled:cursor-not-allowed">
          {t("history.importWithWallets", { defaultValue: "Import with wallets" })}
        </button>
      </div>
    </div>
  );
}
