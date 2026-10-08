"use client";

import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";

/** Stays until dismissed: an import brought raw wallet keys into this browser. */
export function ImportedWalletsNote({ count, onDismiss }: { count: number; onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="status" data-testid="imported-wallets-note" className="flex gap-2 rounded-lg border border-severity-medium/30 bg-surface-elevated p-3 text-xs text-foreground leading-relaxed">
      <ShieldAlert size={14} className="text-severity-medium shrink-0 mt-0.5" aria-hidden="true" />
      <span className="flex-1">
        {t("history.importedWallets", { count, defaultValue: "{{count}} imported bookmarks are wallet keys (xpub). Anyone who can open this browser profile can see their addresses and balances. Remove them in settings on a shared computer." })}
      </span>
      <button type="button" onClick={onDismiss} className="self-start text-bitcoin hover:text-bitcoin-hover font-medium cursor-pointer">
        {t("bookmark.understand", { defaultValue: "Got it" })}
      </button>
    </div>
  );
}
