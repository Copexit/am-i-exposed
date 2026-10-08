"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";

/** Shown before an export that could include wallet keys. Wallets are excluded unless unticked. */
export function ExportWalletsPrompt({ walletCount, onExport, onCancel }: {
  walletCount: number;
  onExport: (includeWallets: boolean) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [exclude, setExclude] = useState(true);
  return (
    <div role="dialog" data-testid="export-wallets-prompt" aria-label={t("history.exportBookmarks", { defaultValue: "Export bookmarks as JSON" })}
      className="rounded-lg border border-severity-medium/30 bg-surface-elevated p-3 space-y-2 text-xs"
      onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
      <p className="flex gap-2 text-foreground leading-relaxed">
        <ShieldAlert size={14} className="text-severity-medium shrink-0 mt-0.5" aria-hidden="true" />
        {t("history.exportWalletsWarning", { count: walletCount, defaultValue: "{{count}} bookmarks are wallet keys (xpub). Anyone with the file can see all their addresses and balances." })}
      </p>
      <label className="flex items-center gap-2 text-foreground cursor-pointer select-none">
        <input type="checkbox" checked={exclude} onChange={(e) => setExclude(e.target.checked)} className="accent-bitcoin" />
        {t("history.exportExcludeWallets", { defaultValue: "Exclude wallets" })}
      </label>
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="text-muted hover:text-foreground cursor-pointer min-h-[32px]">
          {t("wallet.bookmark.cancel", { defaultValue: "Cancel" })}
        </button>
        <button type="button" autoFocus onClick={() => onExport(!exclude)} className="text-bitcoin hover:text-bitcoin-hover font-medium cursor-pointer min-h-[32px]">
          {t("history.export", { defaultValue: "Export" })}
        </button>
      </div>
    </div>
  );
}
