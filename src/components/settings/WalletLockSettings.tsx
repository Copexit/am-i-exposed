"use client";

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Lock, LockOpen } from "lucide-react";
import { useBookmarks } from "@/hooks/useBookmarks";
import { disableLock, enableLock, forgetLockedWallets, lockNow, useWalletLock } from "@/hooks/walletVault";
import { WrongPasswordError } from "@/lib/crypto/envelope";
import { UnlockWalletsPrompt } from "@/components/history/UnlockWalletsPrompt";
import { MIN_PASSWORD_LENGTH, inputClass } from "./BackupExportDialog";

/** Shown after an import that left wallet bookmarks out because of the lock. */
export const skippedMessage = (t: TFunction, count: number) =>
  t("walletLock.importSkipped", { count, defaultValue: "{{count}} wallet bookmarks skipped: with the wallet lock on, wallets are imported only while it is unlocked, and locked ones only when the same password opens both." });

type Mode = "idle" | "enable" | "unlock" | "disable" | "forgot";

/** "Lock saved wallet keys with a password": turn on/off, unlock, lock now, forgot password. */
export function WalletLockSettings() {
  const { t } = useTranslation();
  const id = useId();
  const { bookmarks } = useBookmarks();
  const { on, unlocked } = useWalletLock();
  const [mode, setMode] = useState<Mode>("idle");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<"wrong" | "failed" | null>(null);
  const [busy, setBusy] = useState(false);
  const lockedCount = bookmarks.filter((b) => b.locked === true).length;
  const plainCount = bookmarks.filter((b) => b.type === "wallet" && b.locked !== true).length;

  const go = (m: Mode) => { setMode(m); setPw(""); setPw2(""); setError(null); };
  const run = async (action: () => Promise<boolean>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (await action()) go("idle");
      else setError("failed");
    } catch (e) {
      setError(e instanceof WrongPasswordError ? "wrong" : "failed");
    }
    setBusy(false);
  };

  const tooShort = pw.length < MIN_PASSWORD_LENGTH;
  const mismatch = pw2.length > 0 && pw !== pw2;
  const btn = "text-[11px] min-h-[32px] px-2 rounded-lg border border-card-border hover:border-muted/50 text-muted hover:text-foreground transition-colors cursor-pointer";
  const formBox = "rounded-lg border border-card-border bg-surface-elevated p-3 space-y-2 text-xs";
  const actions = (submitLabel: string, disabled: boolean, danger = false) => (
    <div className="flex justify-end gap-3">
      <button type="button" onClick={() => go("idle")} disabled={busy} className="text-muted hover:text-foreground cursor-pointer min-h-[32px] disabled:opacity-40">
        {t("wallet.bookmark.cancel", { defaultValue: "Cancel" })}
      </button>
      <button type="submit" disabled={busy || disabled} data-testid="wallet-lock-submit"
        className={`${danger ? "text-severity-critical" : "text-bitcoin hover:text-bitcoin-hover"} font-medium cursor-pointer min-h-[32px] disabled:opacity-40 disabled:cursor-not-allowed`}>
        {busy ? t("backup.encrypting", { defaultValue: "Encrypting..." }) : submitLabel}
      </button>
    </div>
  );
  const errorLine = (
    <p id={`${id}-err`} role="alert" className="text-severity-critical empty:hidden">
      {error === "wrong" && t("backup.wrongPassword", { defaultValue: "Wrong password. Try again." })}
      {error === "failed" && t("walletLock.failed", { defaultValue: "The wallet lock could not be updated. Browser storage may be full." })}
    </p>
  );
  const notes = (
    <ul className="space-y-1 text-muted list-disc pl-4 leading-relaxed">
      <li>{t("walletLock.noRecovery", { defaultValue: "The password cannot be recovered. Without it, locked wallet bookmarks can only be deleted." })}</li>
      <li>{t("walletLock.scope", { defaultValue: "The lock protects the keys from anyone reading this browser's storage. It does not protect against malware on this device." })}</li>
    </ul>
  );

  return (
    <div className="border-t border-card-border pt-3 space-y-2" data-testid="wallet-lock-settings">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
        {on ? <Lock size={12} className="text-bitcoin" aria-hidden="true" /> : <LockOpen size={12} aria-hidden="true" />}
        {t("walletLock.title", { defaultValue: "Lock saved wallet keys with a password" })}
      </p>
      <p className="text-[11px] text-muted/70" data-testid="wallet-lock-status">
        {!on
          ? t("walletLock.statusOff", { defaultValue: "Off: the keys (xpubs) of wallet bookmarks are stored unencrypted in this browser." })
          : unlocked
            ? t("walletLock.statusUnlocked", { defaultValue: "On, unlocked in this tab until a reload or \"Lock now\"." })
            : t("walletLock.statusLocked", { defaultValue: "On: wallet bookmark keys are encrypted. The password is asked before a locked wallet opens." })}
        {on && plainCount > 0 && ` ${t("walletLock.notLocked", { count: plainCount, defaultValue: "{{count}} wallet bookmarks are not locked yet. Unlock to lock them." })}`}
      </p>

      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          {!on && <button type="button" className={btn} onClick={() => go("enable")} data-testid="wallet-lock-enable">{t("walletLock.turnOn", { defaultValue: "Turn on" })}</button>}
          {on && !unlocked && <button type="button" className={btn} onClick={() => go("unlock")}>{t("walletLock.unlock", { defaultValue: "Unlock" })}</button>}
          {on && unlocked && <button type="button" className={btn} onClick={lockNow} data-testid="wallet-lock-now">{t("walletLock.lockNow", { defaultValue: "Lock now" })}</button>}
          {on && <button type="button" className={btn} onClick={() => go("disable")}>{t("walletLock.turnOff", { defaultValue: "Turn off" })}</button>}
          {on && !unlocked && <button type="button" className={`${btn} hover:text-severity-critical`} onClick={() => go("forgot")}>{t("walletLock.forgot", { defaultValue: "Forgot password" })}</button>}
        </div>
      )}

      {mode === "unlock" && <UnlockWalletsPrompt onUnlocked={() => go("idle")} onCancel={() => go("idle")} />}

      {mode === "enable" && (
        <form className={formBox} aria-label={t("walletLock.title", { defaultValue: "Lock saved wallet keys with a password" })} aria-busy={busy}
          onKeyDown={(e) => { if (e.key === "Escape" && !busy) { e.stopPropagation(); go("idle"); } }}
          onSubmit={(e) => { e.preventDefault(); if (!tooShort && pw === pw2) void run(() => enableLock(pw)); }}>
          <label className="block space-y-1">
            <span className="text-muted">{t("backup.password", { defaultValue: "Password" })}</span>
            <input type="password" autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)}
              aria-describedby={`${id}-hint`} className={inputClass} data-testid="wallet-lock-password" />
          </label>
          <label className="block space-y-1">
            <span className="text-muted">{t("backup.passwordRepeat", { defaultValue: "Repeat the password" })}</span>
            <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)}
              aria-invalid={mismatch || undefined} className={inputClass} data-testid="wallet-lock-password-repeat" />
          </label>
          <p id={`${id}-hint`} aria-live="polite" className={mismatch ? "text-severity-critical" : "text-muted"}>
            {mismatch
              ? t("backup.passwordMismatch", { defaultValue: "The passwords do not match." })
              : t("backup.passwordMin", { min: MIN_PASSWORD_LENGTH, defaultValue: "At least {{min}} characters" })}
          </p>
          {notes}
          {errorLine}
          {actions(t("walletLock.turnOn", { defaultValue: "Turn on" }), tooShort || pw !== pw2)}
        </form>
      )}

      {mode === "disable" && (
        <form className={formBox} aria-label={t("walletLock.turnOff", { defaultValue: "Turn off" })} aria-busy={busy}
          onKeyDown={(e) => { if (e.key === "Escape" && !busy) { e.stopPropagation(); go("idle"); } }}
          onSubmit={(e) => { e.preventDefault(); if (pw) void run(() => disableLock(pw)); }}>
          <label className="block space-y-1">
            <span className="block text-muted leading-relaxed">{t("walletLock.disableHint", { defaultValue: "Enter the password. The keys are then stored unencrypted again." })}</span>
            <input type="password" autoComplete="current-password" autoFocus value={pw} onChange={(e) => { setPw(e.target.value); setError(null); }}
              aria-invalid={error === "wrong" || undefined} aria-describedby={`${id}-err`} className={inputClass} data-testid="wallet-lock-password" />
          </label>
          {errorLine}
          {actions(t("walletLock.turnOff", { defaultValue: "Turn off" }), !pw)}
        </form>
      )}

      {mode === "forgot" && (
        <form className={formBox} aria-label={t("walletLock.forgot", { defaultValue: "Forgot password" })}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); go("idle"); } }}
          onSubmit={(e) => { e.preventDefault(); forgetLockedWallets(); go("idle"); }}>
          <p className="text-foreground leading-relaxed">
            {t("walletLock.forgotConfirm", { count: lockedCount, defaultValue: "Delete the wallet lock and the {{count}} locked wallet bookmarks? Their keys cannot be recovered. Other bookmarks, saved graphs and saved wallet scans are kept." })}
          </p>
          {actions(t("walletLock.forgotDelete", { defaultValue: "Delete" }), false, true)}
        </form>
      )}
    </div>
  );
}
