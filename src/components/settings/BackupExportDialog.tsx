"use client";

import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Lock, ShieldAlert } from "lucide-react";
import { buildBackup } from "@/hooks/backup";
import { sealJson } from "@/lib/crypto/envelope";
import { downloadJson } from "@/lib/download";
import { listSavedWallets } from "@/lib/wallet/saved-wallets";

export const MIN_PASSWORD_LENGTH = 8;

/** A hint only, never blocking: length is what makes a passphrase hold up. */
function strength(pw: string): "weak" | "fair" | "strong" {
  return pw.length >= 16 ? "strong" : pw.length >= 12 ? "fair" : "weak";
}

export const inputClass = "w-full bg-surface-inset border border-card-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted/70 focus-visible:border-bitcoin/50";

/** Export the full backup: what to include, then a password (on by default) or a plain file. */
export function BackupExportDialog({ walletCount, onDone, onCancel }: {
  walletCount: number;
  onDone: (counts: { bookmarks: number; graphs: number }) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [includeWallets, setIncludeWallets] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [includeSaved, setIncludeSaved] = useState(false);
  const [includeSettings, setIncludeSettings] = useState(false);
  const [protect, setProtect] = useState(true);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void listSavedWallets().then((l) => { if (live) setSavedCount(l.length); });
    return () => { live = false; };
  }, []);

  const tooShort = protect && pw.length < MIN_PASSWORD_LENGTH;
  const mismatch = protect && pw2.length > 0 && pw !== pw2;
  const ready = !protect || (!tooShort && pw === pw2);

  const run = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const payload = await buildBackup({ includeWallets, includeSavedWallets: includeSaved && savedCount > 0, includeSettings });
      if (protect) {
        const date = new Date().toISOString().slice(0, 10);
        downloadJson(`am-i-exposed-backup-${date}.json`, JSON.stringify(await sealJson(payload, pw)));
      } else {
        downloadJson("am-i-exposed-workspace.json", JSON.stringify(payload, null, 2));
      }
      onDone({ bookmarks: payload.bookmarks.length, graphs: payload.graphs.length });
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  const check = (checked: boolean, set: (v: boolean) => void, label: string, testId: string) => (
    <label className="flex items-start gap-2 text-foreground cursor-pointer select-none min-h-[32px]">
      <input type="checkbox" data-testid={testId} checked={checked} onChange={(e) => set(e.target.checked)} className="accent-bitcoin mt-0.5" />
      <span>{label}</span>
    </label>
  );

  return (
    <form
      role="group"
      aria-labelledby={`${id}-title`}
      data-testid="backup-export-dialog"
      className="rounded-lg border border-card-border bg-surface-elevated p-3 space-y-2 text-xs"
      onKeyDown={(e) => { if (e.key === "Escape" && !busy) { e.stopPropagation(); onCancel(); } }}
      onSubmit={(e) => { e.preventDefault(); void run(); }}
    >
      <p id={`${id}-title`} className="font-medium text-foreground">
        {t("backup.exportTitle", { defaultValue: "Export a backup" })}
      </p>
      {walletCount > 0 && (
        <>
          {check(includeWallets, setIncludeWallets, t("backup.includeWallets", { count: walletCount, defaultValue: "Include {{count}} wallet bookmarks" }), "backup-include-wallets")}
          {includeWallets && (
            <p className="flex gap-2 text-foreground leading-relaxed">
              <ShieldAlert size={14} className="text-severity-medium shrink-0 mt-0.5" aria-hidden="true" />
              {t("history.exportWalletsWarning", { count: walletCount, defaultValue: "{{count}} bookmarks are wallet keys (xpub). Anyone with the file can see all their addresses and balances." })}
            </p>
          )}
        </>
      )}
      {savedCount > 0 && check(includeSaved, setIncludeSaved, t("backup.includeSavedWallets", { count: savedCount, defaultValue: "Include saved wallet data ({{count}} wallets)" }), "backup-include-saved")}
      {check(includeSettings, setIncludeSettings, t("backup.includeSettings", { defaultValue: "Include settings" }), "backup-include-settings")}
      {check(protect, setProtect, t("backup.protect", { defaultValue: "Protect with a password" }), "backup-protect")}
      {protect ? (
        <div className="space-y-2 pl-6">
          <label className="block space-y-1">
            <span className="text-muted">{t("backup.password", { defaultValue: "Password" })}</span>
            <input type="password" autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)}
              aria-describedby={`${id}-hint`} className={inputClass} data-testid="backup-password" />
          </label>
          <label className="block space-y-1">
            <span className="text-muted">{t("backup.passwordRepeat", { defaultValue: "Repeat the password" })}</span>
            <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)}
              aria-invalid={mismatch || undefined} aria-describedby={mismatch ? `${id}-mismatch` : undefined} className={inputClass} data-testid="backup-password-repeat" />
          </label>
          <p id={`${id}-hint`} aria-live="polite" className="text-muted">
            {pw.length > 0 && tooShort
              ? t("backup.passwordMin", { min: MIN_PASSWORD_LENGTH, defaultValue: "At least {{min}} characters" })
              : pw.length > 0 && {
                weak: t("backup.strengthWeak", { defaultValue: "Strength: weak (a longer passphrase is safer)" }),
                fair: t("backup.strengthFair", { defaultValue: "Strength: fair" }),
                strong: t("backup.strengthStrong", { defaultValue: "Strength: strong" }),
              }[strength(pw)]}
          </p>
          {mismatch && <p id={`${id}-mismatch`} className="text-severity-critical">{t("backup.passwordMismatch", { defaultValue: "The passwords do not match." })}</p>}
          <p className="flex gap-1.5 text-muted">
            <Lock size={12} className="shrink-0 mt-0.5" aria-hidden="true" />
            {t("backup.noRecovery", { defaultValue: "The password cannot be recovered. Without it the backup cannot be opened." })}
          </p>
        </div>
      ) : (
        <p className="pl-6 text-severity-medium">{t("backup.plainWarning", { defaultValue: "Anyone with the file can read it." })}</p>
      )}
      {failed && <p role="alert" className="text-severity-critical">{t("backup.exportFailed", { defaultValue: "The backup could not be created." })}</p>}
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel} disabled={busy} className="text-muted hover:text-foreground cursor-pointer min-h-[32px] disabled:opacity-40">
          {t("wallet.bookmark.cancel", { defaultValue: "Cancel" })}
        </button>
        <button type="submit" disabled={!ready || busy} data-testid="backup-export-submit"
          className="text-bitcoin hover:text-bitcoin-hover font-medium cursor-pointer min-h-[32px] disabled:opacity-40 disabled:cursor-not-allowed">
          {busy && protect ? t("backup.encrypting", { defaultValue: "Encrypting..." }) : t("history.export", { defaultValue: "Export" })}
        </button>
      </div>
    </form>
  );
}
