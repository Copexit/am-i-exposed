"use client";

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";
import { unlock } from "@/hooks/walletVault";
import { WrongPasswordError } from "@/lib/crypto/envelope";
import { DamagedVaultError } from "@/lib/backup/wallet-vault";
import { inputClass } from "@/components/settings/BackupExportDialog";

/** Password prompt for the wallet key lock. `onUnlocked` runs once the vault is open in this tab. */
export function UnlockWalletsPrompt({ onUnlocked, onCancel }: { onUnlocked: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [pw, setPw] = useState("");
  const [error, setError] = useState<"wrong" | "damaged" | "failed" | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!pw || busy) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(pw);
      onUnlocked();
    } catch (e) {
      setError(e instanceof WrongPasswordError ? "wrong" : e instanceof DamagedVaultError ? "damaged" : "failed");
      setBusy(false);
    }
  };

  return (
    <form
      role="group"
      aria-labelledby={`${id}-title`}
      aria-busy={busy}
      data-testid="unlock-wallets-prompt"
      className="rounded-lg border border-card-border bg-surface-elevated p-3 space-y-2 text-xs"
      onKeyDown={(e) => { if (e.key === "Escape" && !busy) { e.stopPropagation(); onCancel(); } }}
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
    >
      <p id={`${id}-title`} className="flex gap-1.5 font-medium text-foreground">
        <Lock size={13} className="text-bitcoin shrink-0 mt-px" aria-hidden="true" />
        {t("walletLock.unlockTitle", { defaultValue: "Saved wallet keys are locked" })}
      </p>
      <label className="block space-y-1">
        <span className="block text-muted leading-relaxed">{t("walletLock.unlockHint", { defaultValue: "Enter the wallet lock password. They stay unlocked in this tab until a reload or \"Lock now\"." })}</span>
        <input type="password" autoComplete="current-password" autoFocus value={pw}
          onChange={(e) => { setPw(e.target.value); setError(null); }}
          aria-invalid={error === "wrong" || undefined} aria-describedby={`${id}-err`}
          className={inputClass} data-testid="unlock-wallets-password" />
      </label>
      <p id={`${id}-err`} role="alert" className="text-severity-critical empty:hidden">
        {error === "wrong" && t("backup.wrongPassword", { defaultValue: "Wrong password. Try again." })}
        {error === "damaged" && t("walletLock.damaged", { defaultValue: "The wallet lock data is damaged. \"Forgot password\" in the settings resets it." })}
        {error === "failed" && t("walletLock.failed", { defaultValue: "The wallet lock could not be updated. Browser storage may be full." })}
      </p>
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel} disabled={busy} className="text-muted hover:text-foreground cursor-pointer min-h-[32px] disabled:opacity-40">
          {t("wallet.bookmark.cancel", { defaultValue: "Cancel" })}
        </button>
        <button type="submit" disabled={busy || !pw} data-testid="unlock-wallets-submit"
          className="text-bitcoin hover:text-bitcoin-hover font-medium cursor-pointer min-h-[32px] disabled:opacity-40 disabled:cursor-not-allowed">
          {busy ? t("walletLock.unlocking", { defaultValue: "Unlocking..." }) : t("walletLock.unlock", { defaultValue: "Unlock" })}
        </button>
      </div>
    </form>
  );
}
